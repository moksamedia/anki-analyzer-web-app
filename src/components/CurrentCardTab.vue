<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { bridge, buildSummaryRows, buildCardSystemPrompt, buildCardUserMessage, DEFAULT_CARD_USER_PROMPT, loadedDeckCoversCard } from '../composables/useAnkiBridge.js'
import { setCardIntervalDays } from '../composables/useAnki.js'
import { streamMessages } from '../composables/useClaude.js'
import { streamGeminiMessages } from '../composables/useGemini.js'
import {
  useApiKey,
  useGeminiApiKey,
  useAnthropicModel,
  useGeminiModel,
  getCurrentCardAutoUpdate,
  setCurrentCardAutoUpdate,
  useCardAnalysisUserPrompt
} from '../composables/useStorage.js'
import { shortenDeckName, cardFront, reviewSummary } from '../composables/useAnalysis.js'

const props = defineProps({
  loadedDeck: { type: String, default: '' },
  loadedIncludesSubdecks: { type: Boolean, default: false },
  loadedOverview: { type: Object, default: null },
  loadedReviewsByDay: { type: Array, default: null },
  loadedUsesFsrs: { type: Boolean, default: false }
})

marked.setOptions({ gfm: true, breaks: true })

const POLL_INTERVAL_MS = 3000

const apiKey = useApiKey()
const geminiKey = useGeminiApiKey()
const anthropicModelSetting = useAnthropicModel()
const geminiModelSetting = useGeminiModel()
const cardAnalysisUserPromptSetting = useCardAnalysisUserPrompt()

const hasAnthropicKey = computed(() => apiKey.value.trim().length > 0)
const hasGeminiKey = computed(() => geminiKey.value.trim().length > 0)

const bridgeStatus = ref('unknown')   // 'unknown' | 'ok' | 'down'
const bridgeError = ref('')

const card = ref(null)
const deckSummary = ref(null)
const isFetching = ref(false)
const fetchError = ref('')
const autoUpdate = ref(false)
let pollTimer = null

const showFields = ref(false)
const showHistory = ref(true)

const messages = ref([])              // [{ role: 'user'|'assistant', text, streaming? }]
const streamingMessage = ref(null)    // the assistant message being filled
const isStreaming = ref(false)
const analysisError = ref('')
/** @type {import('vue').Ref<'claude' | 'gemini' | null>} */
const activeAnalysisProvider = ref(null)
const chatInput = ref('')
const chatScrollAnchor = ref(null)
const cardSystemPrompt = buildCardSystemPrompt()
const intervalAdjustMode = ref(null) // 'known' | 'overestimated' | null
const intervalAdjustScore = ref(7)
const intervalAdjustCustomDays = ref('')
const isApplyingIntervalAdjust = ref(false)
const intervalAdjustStatus = ref('')

/** @type {import('vue').Ref<{ prior: unknown, updated: unknown | null, error?: string } | null>} */
const gradedCardTransition = ref(null)

function snapshotCardCtx(ctx) {
  if (!ctx?.card?.id) return null
  return JSON.parse(JSON.stringify(ctx))
}

function pickNewGradeRow(priorCtx, updatedCtx) {
  const uh = updatedCtx?.history || []
  if (!uh.length) return null
  const maxPrior = (priorCtx?.history || []).reduce(
    (m, r) => Math.max(m, r.timestamp_ms ?? 0),
    0
  )
  const newer = uh.filter(r => (r.timestamp_ms ?? 0) > maxPrior)
  if (newer.length) {
    return newer.reduce((best, r) =>
      (r.timestamp_ms ?? 0) > (best.timestamp_ms ?? 0) ? r : best
    )
  }
  return uh.reduce((best, r) =>
    (r.timestamp_ms ?? 0) > (best.timestamp_ms ?? 0) ? r : best
  )
}

function fmtNum(v, decimals = null) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  if (decimals != null) return n.toFixed(decimals)
  return String(Math.round(n))
}

function fmtDelta(a, b, decimals = 2) {
  if (
    a == null
    || b == null
    || Number.isNaN(Number(a))
    || Number.isNaN(Number(b))
  ) return '—'
  const d = Number(b) - Number(a)
  if (Math.abs(d) < 1e-9) return '±0'
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(decimals)}`
}

const gradedReviewPanel = computed(() => {
  const t = gradedCardTransition.value
  if (!t?.prior || !autoUpdate.value) return null

  const prior = t.prior
  const pid = prior.card?.id

  if (t.error) {
    return {
      headline: pid != null ? `Card #${pid}` : 'Graded card',
      sub: String(prior.deck || '').slice(0, 180),
      error: t.error,
      gradeRow: null,
      gradeCaption: '',
      schedulerLabel: '',
      rows: [],
      schedulingRows: [],
      schedulingNote: ''
    }
  }

  if (!t.updated) return null
  const updated = t.updated
  const pCard = prior.card || {}
  const uCard = updated.card || {}
  const pSch = prior.scheduling || {}
  const uSch = updated.scheduling || {}
  const sched = uSch.scheduler || pSch.scheduler || ''
  const gradeRow = pickNewGradeRow(prior, updated)

  const headline = [
    String(updated.deck || prior.deck || 'Deck'),
    String(uCard.template || pCard.template || 'Card'),
    `#${uCard.id ?? pCard.id ?? '?'}`
  ].join(' · ')

  const schedulerLabel =
    sched === 'fsrs'
      ? 'FSRS (DSR · interval)'
      : sched === 'sm2'
        ? 'SM-2'
        : sched
          ? String(sched).toUpperCase()
          : 'SRS'

  const row = (label, a, b, dec = 2) => ({
    label,
    before: fmtNum(a, dec),
    after: fmtNum(b, dec),
    delta: fmtDelta(a, b, dec)
  })

  const rows = []
  if (sched === 'fsrs') {
    rows.push(row('Difficulty (D)', pSch.difficulty, uSch.difficulty, 3))
    rows.push(row('Stability (days)', pSch.stability_days, uSch.stability_days, 2))
    if (pSch.retrievability != null || uSch.retrievability != null) {
      rows.push(row('Retrievability (R)', pSch.retrievability, uSch.retrievability, 3))
    }
  } else {
    rows.push(row('Ease % (legacy)', pCard.ease_factor_pct, uCard.ease_factor_pct, 1))
  }

  rows.push(row('Interval (scheduled days)', pCard.ivl_days, uCard.ivl_days, 2))
  rows.push(row('Lapses', pCard.lapses, uCard.lapses, 0))
  rows.push(row('Reps', pCard.reps, uCard.reps, 0))

  const schedulingRows = []
  let schedulingNote = ''
  if (gradeRow && (gradeRow.interval_days_before != null || gradeRow.interval_days_after != null)) {
    schedulingRows.push({
      label: `This review (${String(gradeRow.button ?? 'Grade')})`,
      before: `${fmtNum(gradeRow.interval_days_before, 2)} d`,
      after: `${fmtNum(gradeRow.interval_days_after, 2)} d`,
      delta:
        gradeRow.interval_days_before != null
        && gradeRow.interval_days_after != null
        && !Number.isNaN(Number(gradeRow.interval_days_before))
        && !Number.isNaN(Number(gradeRow.interval_days_after))
          ? fmtDelta(
            gradeRow.interval_days_before,
            gradeRow.interval_days_after,
            2
          )
          : '—'
    })
  } else if (gradeRow?.button != null && !schedulingRows.length) {
    schedulingNote = `Recorded button: ${gradeRow.button}`
  }

  const gradeCaption = gradeRow && gradeRow.button != null
    ? [
        `${gradeRow.button}`,
        gradeRow.review_type != null ? String(gradeRow.review_type) : null,
        gradeRow.interval_days_before != null && gradeRow.interval_days_after != null
          ? `interval ${fmtNum(gradeRow.interval_days_before, 2)}d → ${fmtNum(gradeRow.interval_days_after, 2)}d`
          : null
      ].filter(Boolean).join(' · ')
    : ''

  return {
    headline,
    sub: '',
    error: null,
    gradeRow,
    gradeCaption,
    schedulerLabel,
    rows,
    schedulingRows,
    schedulingNote
  }
})

function dismissGradeEffectPanel() {
  gradedCardTransition.value = null
}

function openIntervalAdjust(mode) {
  if (!card.value?.card?.id) return
  intervalAdjustStatus.value = ''
  intervalAdjustMode.value = mode
  intervalAdjustScore.value = mode === 'known' ? 8 : 7
  intervalAdjustCustomDays.value = ''
}

function closeIntervalAdjust() {
  if (isApplyingIntervalAdjust.value) return
  intervalAdjustMode.value = null
}

function randomFuzz(value, ratio) {
  if (!ratio || ratio <= 0) return value
  const drift = (Math.random() * 2 - 1) * ratio
  return value * (1 + drift)
}

function clampDays(days) {
  const d = Math.round(Number(days) || 1)
  return Math.max(1, Math.min(36500, d))
}

function parseCustomDays(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  if (n <= 0) return null
  return clampDays(n)
}

function fuzzCustomDays(days) {
  const base = clampDays(days)
  const jitter = Math.max(1, Math.min(3, Math.round(base * 0.04)))
  const delta = Math.round((Math.random() * 2 - 1) * jitter)
  return clampDays(base + delta)
}

function targetIntervalDays(mode, score, currentDays, includeFuzz = true) {
  const s = Math.max(1, Math.min(10, Math.round(Number(score) || 1)))
  const current = Math.max(0, Number(currentDays) || 0)
  const knownBaseByScore = [2, 4, 7, 12, 18, 30, 45, 75, 120, 180]
  const overBaseByScore = [1, 2, 3, 5, 8, 12, 18, 26, 35, 50]
  const knownBase = knownBaseByScore[s - 1]
  const overBase = overBaseByScore[s - 1]

  if (mode === 'known') {
    const floor = current > 0 ? current * 1.4 : 0
    const target = Math.max(knownBase, floor)
    return clampDays(includeFuzz ? randomFuzz(target, 0.18) : target)
  }

  const multiplier = 1.05 + s * 0.14 // 1.19x .. 2.45x
  const scaled = current > 0 ? Math.max(current + 1, current * multiplier) : overBase
  return clampDays(includeFuzz ? randomFuzz(scaled, 0.1) : scaled)
}

const intervalAdjustPreview = computed(() => {
  if (!card.value || !intervalAdjustMode.value) return null
  const current = Number(card.value.card?.ivl_days || 0)
  const mode = intervalAdjustMode.value
  const score = intervalAdjustScore.value
  const custom = parseCustomDays(intervalAdjustCustomDays.value)
  const target = custom != null ? custom : targetIntervalDays(mode, score, current, false)
  return {
    current,
    target,
    modeLabel: mode === 'known' ? 'Know already' : 'Overestimated difficulty',
    usingCustom: custom != null
  }
})

async function applyIntervalAdjustment() {
  if (!card.value?.card?.id || !intervalAdjustMode.value) return
  const cardId = card.value.card.id
  const mode = intervalAdjustMode.value
  const score = intervalAdjustScore.value
  const custom = parseCustomDays(intervalAdjustCustomDays.value)
  const targetDays = custom != null
    ? fuzzCustomDays(custom)
    : targetIntervalDays(mode, score, card.value.card?.ivl_days || 0)

  isApplyingIntervalAdjust.value = true
  intervalAdjustStatus.value = ''
  fetchError.value = ''
  try {
    await setCardIntervalDays(cardId, targetDays)
    intervalAdjustStatus.value =
      `${mode === 'known' ? 'Know already' : 'Overestimated difficulty'} applied: interval set to ${targetDays}d${custom != null ? ' (custom with fuzz)' : ''}.`
    intervalAdjustMode.value = null
    await fetchCurrent()
    await refreshDeckSummary()
  } catch (e) {
    fetchError.value = e.message || String(e)
  } finally {
    isApplyingIntervalAdjust.value = false
  }
}

onMounted(async () => {
  autoUpdate.value = await getCurrentCardAutoUpdate()
  await checkBridge()
})

onBeforeUnmount(() => {
  stopPolling()
})

async function checkBridge() {
  bridgeError.value = ''
  try {
    const h = await bridge.health()
    bridgeStatus.value = h?.ok ? 'ok' : 'down'
  } catch (e) {
    bridgeStatus.value = 'down'
    bridgeError.value = e.message
  }
}

async function fetchCurrent({ silent = false } = {}) {
  if (isStreaming.value) return
  if (!silent) {
    isFetching.value = true
    fetchError.value = ''
  }
  try {
    const ctx = await bridge.currentCard()
    const prevId = card.value?.card?.id
    card.value = ctx
    const summary = await bridge.deckSummary(ctx.deck_id)
    deckSummary.value = summary
    if (prevId !== ctx.card.id) {
      // New card — clear prior analysis automatically.
      messages.value = []
      streamingMessage.value = null
      analysisError.value = ''
      activeAnalysisProvider.value = null
    }
  } catch (e) {
    if (!silent) fetchError.value = e.message
  } finally {
    if (!silent) isFetching.value = false
  }
}

async function refreshDeckSummary() {
  if (!card.value) return
  isFetching.value = true
  try {
    deckSummary.value = await bridge.refreshDeckSummary(card.value.deck_id)
  } catch (e) {
    fetchError.value = e.message
  } finally {
    isFetching.value = false
  }
}

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    if (isStreaming.value || !autoUpdate.value) return
    try {
      const h = await bridge.health()
      const currId = card.value?.card?.id
      if (h?.current_card_id != null && currId != null && h.current_card_id !== currId) {
        let priorSnap = null
        try {
          priorSnap = snapshotCardCtx(card.value)
        } catch {
          priorSnap = null
        }
        const priorId = priorSnap?.card?.id
        await fetchCurrent({ silent: true })
        if (
          priorSnap
          && priorId
          && card.value?.card?.id != null
          && card.value.card.id !== priorId
        ) {
          try {
            const updatedCtx = await bridge.card(priorId)
            gradedCardTransition.value = { prior: priorSnap, updated: updatedCtx }
          } catch (e) {
            gradedCardTransition.value = {
              prior: priorSnap,
              updated: null,
              error: e.message
            }
          }
        }
      }
    } catch { /* bridge briefly down — ignore */ }
  }, POLL_INTERVAL_MS)
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

watch(autoUpdate, (on) => {
  setCurrentCardAutoUpdate(on)
  if (on) startPolling()
  else {
    stopPolling()
    gradedCardTransition.value = null
  }
})

const summaryRows = computed(() => {
  if (!card.value || !deckSummary.value) return []
  return buildSummaryRows(card.value, deckSummary.value)
})

const fieldsList = computed(() => {
  if (!card.value) return []
  return Object.entries(card.value.note.fields)
})

const historyRows = computed(() => {
  if (!card.value?.history) return []
  return [...card.value.history].sort(
    (a, b) => (b.timestamp_ms ?? 0) - (a.timestamp_ms ?? 0)
  )
})

const visibleMessages = computed(() => {
  return messages.value.filter((m, i) => {
    return !(i === 0 && m.role === 'user' && String(m.text || '').includes('## Card under review'))
  })
})

const primaryFields = computed(() => {
  if (!card.value) return []
  return Object.entries(card.value.note.fields).slice(0, 2)
})

const cardHealth = computed(() => {
  if (!card.value) return null
  const c = card.value.card
  const s = card.value.scheduling

  if ((c.reps ?? 0) === 0) {
    return { level: 'new', label: 'New card', reason: 'no reviews yet' }
  }

  const lapses = c.lapses ?? 0
  if (s.scheduler === 'fsrs') {
    const d = s.difficulty ?? 0
    if (d >= 7.5 || lapses >= 4) {
      return { level: 'bad', label: 'In trouble', reason: `D=${d.toFixed(1)}/10, ${lapses} lapses` }
    }
    if (d >= 5.5 || lapses >= 2) {
      return { level: 'warn', label: 'Struggling a bit', reason: `D=${d.toFixed(1)}/10, ${lapses} lapses` }
    }
    return { level: 'good', label: 'Doing well', reason: `D=${d.toFixed(1)}/10, ${lapses} lapses` }
  } else {
    const ease = c.ease_factor_pct ?? 250
    if (ease < 200 || lapses >= 4) {
      return { level: 'bad', label: 'In trouble', reason: `${Math.round(ease)}% ease, ${lapses} lapses` }
    }
    if (ease < 240 || lapses >= 2) {
      return { level: 'warn', label: 'Struggling a bit', reason: `${Math.round(ease)}% ease, ${lapses} lapses` }
    }
    return { level: 'good', label: 'Doing well', reason: `${Math.round(ease)}% ease, ${lapses} lapses` }
  }
})

const cardHeader = computed(() => {
  if (!card.value) return ''
  const c = card.value.card
  return `${card.value.deck} · ${c.template} · ${c.queue}`
})

const enrichmentApplies = computed(() => {
  if (!card.value) return false
  return loadedDeckCoversCard(props.loadedDeck, props.loadedIncludesSubdecks, card.value.deck)
    && props.loadedOverview
})

function buildEnrichmentMarkdown() {
  if (!enrichmentApplies.value) return ''
  const ov = props.loadedOverview
  const lapsers = (ov.lapseCards || []).slice(0, 15).map(c => {
    const front = (cardFront(c) || '').slice(0, 80) || '(media)'
    const dn = shortenDeckName(c.deckName || '')
    return `- [${dn}] "${front}" — ${c.lapses} lapses, ${Math.round((c.factor || 0) / 10)}% ease, ${c.interval}d`
  }).join('\n')

  const review = props.loadedReviewsByDay ? reviewSummary(props.loadedReviewsByDay, 30) : null
  const reviewLine = review
    ? `- Active days (last 30): ${review.activeDays}/30, total reviews: ${review.total}, daily avg: ${review.dailyAvg}`
    : ''

  return [
    '## Deck-level enrichment (from full deck scan via AnkiConnect)',
    `Loaded deck scope: **${props.loadedDeck}**${props.loadedIncludesSubdecks ? ' (with subdecks)' : ' (root only)'}`,
    `Cards analyzed: ${ov.cardCount} (sample ${ov.sampleCount}); due today: ${ov.totalDue} review + ${ov.totalNew} new`,
    `Average interval: ${ov.avgInterval} days; average legacy ease: ${Math.round((ov.avgEase || 0) / 10)}%`,
    reviewLine,
    '',
    '### Top 15 lapsers in the loaded scope (with field content)',
    lapsers || '_no high-lapse cards in loaded scope_'
  ].filter(Boolean).join('\n')
}

async function analyzeWith(provider) {
  if (!card.value || !deckSummary.value) return
  const key =
    provider === 'gemini' ? geminiKey.value.trim() : apiKey.value.trim()
  if (!key) {
    analysisError.value =
      provider === 'gemini'
        ? 'Set your Google Gemini API key in Settings first.'
        : 'Set your Anthropic API key first.'
    return
  }

  activeAnalysisProvider.value = provider

  isStreaming.value = true
  analysisError.value = ''
  const enrichment = buildEnrichmentMarkdown()
  const userPromptText = cardAnalysisUserPromptSetting.value || DEFAULT_CARD_USER_PROMPT
  const userText = buildCardUserMessage(card.value, deckSummary.value, enrichment, userPromptText)
  messages.value = [{ role: 'user', text: userText }]
  const assistantMsg = {
    role: 'assistant',
    text: '',
    streaming: true,
    usage: null,
    provider
  }
  messages.value.push(assistantMsg)
  streamingMessage.value = assistantMsg
  await scrollToBottom()

  const streamFn =
    provider === 'gemini' ? streamGeminiMessages : streamMessages

  try {
    const payload = [{ role: 'user', content: userText }]
    const streamOpts =
      provider === 'gemini'
        ? {
            systemText: cardSystemPrompt,
            maxTokens: 4096,
            model: geminiModelSetting.value
          }
        : {
            systemText: cardSystemPrompt,
            maxTokens: 4096,
            model: anthropicModelSetting.value
          }
    for await (const chunk of streamFn(key, payload, streamOpts)) {
      if (chunk.type === 'text') {
        assistantMsg.text += chunk.text
        await scrollToBottom()
      } else if (chunk.type === 'usage') {
        assistantMsg.usage = chunk.usage
      }
    }
    delete assistantMsg.streaming
  } catch (e) {
    analysisError.value = e.message
    activeAnalysisProvider.value = null
    messages.value.pop()
    messages.value.pop()
  } finally {
    isStreaming.value = false
    streamingMessage.value = null
  }
}

async function sendFollowup() {
  const text = chatInput.value.trim()
  if (!text || !messages.value.length) return
  const provider = activeAnalysisProvider.value
  if (!provider) {
    analysisError.value = 'Analyze with Claude or Gemini first, then ask a follow-up.'
    return
  }
  const key =
    provider === 'gemini' ? geminiKey.value.trim() : apiKey.value.trim()
  if (!key) {
    analysisError.value =
      provider === 'gemini'
        ? 'Set your Google Gemini API key in Settings to continue chatting.'
        : 'Set your Anthropic API key in Settings to continue chatting.'
    return
  }

  isStreaming.value = true
  analysisError.value = ''
  chatInput.value = ''
  messages.value.push({ role: 'user', text })
  const assistantMsg = {
    role: 'assistant',
    text: '',
    streaming: true,
    usage: null,
    provider
  }
  messages.value.push(assistantMsg)
  streamingMessage.value = assistantMsg
  await scrollToBottom()

  const payload = messages.value
    .slice(0, -1) // exclude the streaming placeholder
    .map(m => ({ role: m.role, content: m.text }))

  const streamFn =
    provider === 'gemini' ? streamGeminiMessages : streamMessages

  try {
    const streamOpts =
      provider === 'gemini'
        ? {
            systemText: cardSystemPrompt,
            maxTokens: 4096,
            model: geminiModelSetting.value
          }
        : {
            systemText: cardSystemPrompt,
            maxTokens: 4096,
            model: anthropicModelSetting.value
          }
    for await (const chunk of streamFn(key, payload, streamOpts)) {
      if (chunk.type === 'text') {
        assistantMsg.text += chunk.text
        await scrollToBottom()
      } else if (chunk.type === 'usage') {
        assistantMsg.usage = chunk.usage
      }
    }
    delete assistantMsg.streaming
  } catch (e) {
    analysisError.value = e.message
    messages.value.pop()
    messages.value.pop()
  } finally {
    isStreaming.value = false
    streamingMessage.value = null
  }
}

function onChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendFollowup()
  }
}

async function scrollToBottom() {
  await nextTick()
  chatScrollAnchor.value?.scrollIntoView({ behavior: 'smooth', block: 'end' })
}

function renderMarkdown(text) {
  if (!text) return ''
  return DOMPurify.sanitize(marked.parse(text))
}

function assistantLabel(m) {
  if (m.role === 'user') return 'You'
  return m.provider === 'gemini' ? 'Gemini' : 'Claude'
}

function plainFromUserMessage(text) {
  // The initial user message embeds the JSON context — hide it in the rendered view.
  if (text.includes('## Card under review')) {
    const intro = text.split('## Card under review')[0].trim()
    return `${intro}\n\n_[card + deck context attached]_`
  }
  return text
}

function formatLearningSeconds(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0))
  const hours = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = s % 60
  const parts = []
  if (hours) parts.push(`${hours}h`)
  if (mins) parts.push(`${mins}m`)
  if (secs || parts.length === 0) parts.push(`${secs}s`)
  return parts.join(' ')
}

function formatScheduledInterval(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return '—'
  if (v < 0) return formatLearningSeconds(Math.abs(v))
  if (Math.abs(v - Math.round(v)) < 1e-9) return `${Math.round(v)}d`
  return `${v.toFixed(2)}d`
}

function formatIntervalTransition(before, after) {
  return `${formatScheduledInterval(before)} → ${formatScheduledInterval(after)}`
}

function intervalKindClassFromValue(value) {
  const v = Number(value)
  if (!Number.isFinite(v)) return ''
  return v < 0 ? 'history-interval-learning' : 'history-interval-review'
}
</script>

<template>
  <div v-if="bridgeStatus === 'down'" class="error" style="display: block;">
    <strong>Bridge addon not reachable on http://127.0.0.1:8766.</strong><br />
    Install the <code>anki-ai-bridge</code> addon and restart Anki. Then click "Retry".
    <div style="margin-top: 8px;">
      <button class="btn-outline" @click="checkBridge">Retry</button>
    </div>
    <div v-if="bridgeError" class="hint" style="margin-top: 6px;">{{ bridgeError }}</div>
  </div>

  <template v-else>
    <div v-if="!hasAnthropicKey && !hasGeminiKey" class="hint" style="margin-bottom: 1rem;">
      Add an <strong>Anthropic</strong> or <strong>Google Gemini</strong> API key in the <strong>Settings</strong>
      tab to enable card analysis.
    </div>

    <div class="toolbar">
      <div class="section-title" style="margin: 0;">Current card</div>
      <div class="row">
        <label class="row" style="gap: 6px; font-size: 13px; cursor: pointer;">
          <input type="checkbox" v-model="autoUpdate" />
          <span>Auto-update</span>
        </label>
        <button
          class="btn"
          @click="fetchCurrent()"
          :disabled="isFetching || isStreaming"
        >
          <span v-if="isFetching" class="spinner"></span>
          {{ card ? 'Refresh' : 'Fetch from Anki' }}
        </button>
      </div>
    </div>

    <div
      v-if="autoUpdate && gradedReviewPanel"
      class="graded-review-effect ai-box"
      style="padding: 14px 16px; margin-bottom: 14px;"
    >
      <div class="graded-review-effect-header">
        <div style="min-width: 0;">
          <div class="section-title" style="margin: 0 0 6px 0;">
            Effect on previous card after your answer
          </div>
          <div class="metric-sub graded-review-headline">{{ gradedReviewPanel.headline }}</div>
          <div v-if="gradedReviewPanel.sub" class="hint" style="margin-top: 4px;">
            {{ gradedReviewPanel.sub }}
          </div>
        </div>
        <button type="button" class="btn-outline graded-review-dismiss" @click="dismissGradeEffectPanel">
          Dismiss
        </button>
      </div>

      <div v-if="gradedReviewPanel.error" class="error" style="display: block; margin-top: 10px;">
        Could not reload the graded card after the answer: {{ gradedReviewPanel.error }}
      </div>

      <template v-else>
        <div class="graded-review-meta">
          <span class="graded-review-sched-chip">{{ gradedReviewPanel.schedulerLabel }}</span>
          <span v-if="gradedReviewPanel.gradeCaption" class="graded-review-grade-line">
            {{ gradedReviewPanel.gradeCaption }}
          </span>
        </div>

        <table class="graded-review-table" v-if="gradedReviewPanel.rows.length">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Before answer</th>
              <th>After answer</th>
              <th>Δ</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rw in gradedReviewPanel.rows" :key="rw.label">
              <td>{{ rw.label }}</td>
              <td>{{ rw.before }}</td>
              <td>{{ rw.after }}</td>
              <td class="graded-review-delta">{{ rw.delta }}</td>
            </tr>
          </tbody>
        </table>

        <div v-if="gradedReviewPanel.schedulingRows.length" class="graded-review-sched-note">
          <div class="hint" style="margin: 0 0 6px;">
            Scheduling step from this grade (same values as highlighted row in reviewer history):
          </div>
          <table class="graded-review-table graded-review-sched-table">
            <thead>
              <tr>
                <th></th>
                <th>Before</th>
                <th>After</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="sr in gradedReviewPanel.schedulingRows" :key="sr.label">
                <td>{{ sr.label }}</td>
                <td>{{ sr.before }}</td>
                <td>{{ sr.after }}</td>
                <td class="graded-review-delta">{{ sr.delta }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else-if="gradedReviewPanel.schedulingNote" class="hint" style="margin-top: 8px;">
          {{ gradedReviewPanel.schedulingNote }}
        </p>
      </template>
    </div>

    <div v-if="fetchError" class="error" style="display: block;">{{ fetchError }}</div>

    <div v-if="!card && !isFetching" class="hint" style="margin: 12px 0;">
      Open a card in Anki's reviewer (show the answer), then click "Fetch from Anki".
    </div>

    <div v-if="card" class="ai-box" style="padding: 16px;">
      <div class="card-header-row">
        <div class="metric-sub">
          {{ cardHeader }} · card #{{ card.card.id }}
        </div>
        <span
          v-if="cardHealth"
          class="health-badge"
          :class="'health-badge-' + cardHealth.level"
          :title="cardHealth.reason"
        >
          <span class="health-dot"></span>{{ cardHealth.label }}
        </span>
      </div>

      <div
        v-if="primaryFields.length"
        class="primary-fields"
        :class="cardHealth ? 'health-' + cardHealth.level : ''"
      >
        <div v-for="[name, value] in primaryFields" :key="name" class="primary-field">
          <div class="primary-field-label">{{ name }}</div>
          <div class="primary-field-value">{{ value || '—' }}</div>
        </div>
      </div>

      <table class="summary-table">
        <thead>
          <tr><th>Metric</th><th>Value</th><th>Rank in deck</th></tr>
        </thead>
        <tbody>
          <tr v-for="row in summaryRows" :key="row.label">
            <td>{{ row.label }}</td>
            <td>{{ row.value }}</td>
            <td>{{ row.rank }}</td>
          </tr>
        </tbody>
      </table>

      <div class="row" style="margin-top: 12px; gap: 8px;">
        <button
          class="btn-outline"
          @click="openIntervalAdjust('known')"
          :disabled="isFetching || isStreaming || isApplyingIntervalAdjust"
          title="Boost interval for cards you already know well"
        >
          Know already
        </button>
        <button
          class="btn-outline"
          @click="openIntervalAdjust('overestimated')"
          :disabled="isFetching || isStreaming || isApplyingIntervalAdjust"
          title="Nudge interval up when difficulty seems overestimated"
        >
          Overestimated difficulty
        </button>
      </div>
      <p v-if="intervalAdjustStatus" class="hint" style="margin-top: 8px;">
        {{ intervalAdjustStatus }}
      </p>

      <div class="row" style="margin-top: 10px; gap: 8px;">
        <button class="btn-outline" @click="showHistory = !showHistory">
          {{ showHistory ? 'Hide' : 'Show' }} review history ({{ card.history.length }})
        </button>
        <button class="btn-outline" @click="showFields = !showFields">
          {{ showFields ? 'Hide' : 'Show' }} fields
        </button>
        <button class="btn-outline" @click="refreshDeckSummary" :disabled="isFetching">
          Recompute deck summary
        </button>
      </div>

      <div v-if="showHistory" class="history-block">
        <table class="history-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Btn</th>
              <th>Type</th>
              <th title="Review rows are highlighted green and shown in days. Learn/relearn rows are highlighted yellow and stored as negative seconds, shown here as h/m/s.">
                Scheduled interval before → after
              </th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in historyRows" :key="i">
              <td>{{ new Date(r.timestamp_ms).toLocaleString() }}</td>
              <td>{{ r.button }}</td>
              <td>{{ r.review_type }}</td>
              <td>
                <span class="history-interval-transition">
                  <span
                    class="history-interval-pill"
                    :class="intervalKindClassFromValue(r.interval_days_before)"
                  >
                    {{ formatScheduledInterval(r.interval_days_before) }}
                  </span>
                  <span class="history-interval-arrow">→</span>
                  <span
                    class="history-interval-pill"
                    :class="intervalKindClassFromValue(r.interval_days_after)"
                  >
                    {{ formatScheduledInterval(r.interval_days_after) }}
                  </span>
                </span>
              </td>
              <td>{{ r.time_taken_secs.toFixed(1) }}s</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="showFields" class="fields-block">
        <div v-for="[name, value] in fieldsList" :key="name" class="field-row">
          <div class="field-name">{{ name }}</div>
          <div class="field-value">{{ value || '—' }}</div>
        </div>
      </div>
    </div>

    <div v-if="intervalAdjustMode" class="modal-backdrop" @click.self="closeIntervalAdjust">
      <div class="modal" style="max-width: 520px;">
        <h2>{{ intervalAdjustMode === 'known' ? 'Know already' : 'Overestimated difficulty' }}</h2>
        <p>
          Rate how well you know this card from 1 (barely) to 10 (fully internalized).
          The app will update the interval through AnkiConnect with a small randomized fuzz.
        </p>

        <div class="interval-adjust-slider">
          <label for="interval-adjust-score" class="hint" style="display: block; margin-bottom: 6px;">
            Knowledge score
          </label>
          <input
            id="interval-adjust-score"
            v-model.number="intervalAdjustScore"
            type="range"
            min="1"
            max="10"
            step="1"
            :disabled="isApplyingIntervalAdjust"
          />
          <div class="row" style="justify-content: space-between; margin-top: 4px;">
            <span class="hint">1</span>
            <strong style="font-size: 18px;">{{ intervalAdjustScore }}</strong>
            <span class="hint">10</span>
          </div>
        </div>

        <div class="interval-adjust-custom">
          <label for="interval-adjust-custom-days" class="hint" style="display: block; margin-bottom: 6px;">
            Custom interval in days (optional)
          </label>
          <input
            id="interval-adjust-custom-days"
            v-model.trim="intervalAdjustCustomDays"
            type="number"
            min="1"
            step="1"
            class="search-input"
            placeholder="e.g. 80"
            :disabled="isApplyingIntervalAdjust"
          />
          <div class="hint" style="margin-top: 4px;">
            If set, this overrides the score-based estimate. A small random fuzz still applies
            (for example 80d may become around 77–83d).
          </div>
        </div>

        <div v-if="intervalAdjustPreview" class="interval-adjust-preview">
          <div class="metric-sub">
            {{ intervalAdjustPreview.modeLabel }}:
            {{ intervalAdjustPreview.current }}d → ~{{ intervalAdjustPreview.target }}d
            <span v-if="intervalAdjustPreview.usingCustom">(custom)</span>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn-outline" @click="closeIntervalAdjust" :disabled="isApplyingIntervalAdjust">
            Cancel
          </button>
          <button class="btn" @click="applyIntervalAdjustment" :disabled="isApplyingIntervalAdjust">
            <span v-if="isApplyingIntervalAdjust" class="spinner"></span>
            Apply interval update
          </button>
        </div>
      </div>
    </div>

    <div v-if="card" class="toolbar row" style="margin-top: 16px; align-items: center; gap: 10px;">
      <div class="section-title" style="margin: 0;">AI analysis</div>
      <div class="row" style="flex-wrap: wrap; gap: 8px;">
        <button
          class="btn"
          @click="analyzeWith('claude')"
          :disabled="isStreaming || isFetching || !deckSummary"
        >
          <span v-if="isStreaming && !messages.length" class="spinner"></span>
          {{
            messages.length
              ? (activeAnalysisProvider === 'claude' ? 'Re-analyze' : 'Analyze with Claude')
              : 'Analyze with Claude'
          }}
        </button>
        <button
          class="btn-outline"
          @click="analyzeWith('gemini')"
          :disabled="isStreaming || isFetching || !deckSummary"
        >
          <span v-if="isStreaming && !messages.length" class="spinner"></span>
          {{
            messages.length
              ? (activeAnalysisProvider === 'gemini' ? 'Re-analyze' : 'Analyze with Gemini')
              : 'Analyze with Gemini'
          }}
        </button>
      </div>
    </div>

    <div v-if="card" class="hint" style="margin: 6px 0 12px 0;">
      <template v-if="enrichmentApplies">
        ✓ Analysis will include the loaded deck's top lapsers (with field content) and recent review rhythm from <strong>{{ loadedDeck }}</strong>.
      </template>
      <template v-else>
        Tip: load the card's deck via "Choose deck" above so the model receives richer context (top lapsers with field content, review heatmap).
      </template>
    </div>

    <div v-if="analysisError" class="error" style="display: block;">{{ analysisError }}</div>

    <div v-if="visibleMessages.length" class="chat-thread">
      <div
        v-for="(m, i) in visibleMessages"
        :key="i"
        class="chat-message"
        :class="m.role === 'user' ? 'chat-user' : 'chat-assistant'"
      >
        <div class="chat-role">{{ assistantLabel(m) }}</div>
        <div
          v-if="m.role === 'assistant'"
          class="chat-body ai-md"
          v-html="renderMarkdown(m.text)"
        ></div>
        <div v-else class="chat-body chat-user-text">{{ plainFromUserMessage(m.text) }}</div>
        <div v-if="m.streaming" class="chat-streaming">
          <span class="spinner spinner-dark"></span> streaming…
        </div>
        <div v-if="m.usage && !m.streaming" class="ai-meta">
          {{ m.usage.input_tokens }} in
          <span v-if="m.usage.cache_read_input_tokens">(cached {{ m.usage.cache_read_input_tokens }})</span>
          · {{ m.usage.output_tokens }} out
        </div>
      </div>
      <div ref="chatScrollAnchor"></div>
    </div>

    <div v-if="visibleMessages.length" class="chat-input-row">
      <textarea
        v-model="chatInput"
        class="chat-input"
        rows="2"
        placeholder="Ask a follow-up about this card… (Enter to send, Shift+Enter for newline)"
        :disabled="isStreaming"
        @keydown="onChatKeydown"
      ></textarea>
      <button
        class="btn"
        @click="sendFollowup"
        :disabled="!chatInput.trim() || isStreaming"
      >
        <span v-if="isStreaming" class="spinner"></span>
        Send
      </button>
    </div>
  </template>
</template>

<style scoped>
.card-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.health-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}
.health-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.health-badge-good {
  background: var(--teal-light);
  color: var(--teal-dark);
  border-color: var(--teal);
}
.health-badge-good .health-dot { background: var(--teal); }
.health-badge-warn {
  background: var(--amber-light);
  color: var(--amber-dark);
  border-color: var(--amber);
}
.health-badge-warn .health-dot { background: var(--amber); }
.health-badge-bad {
  background: var(--red-light);
  color: var(--red-dark);
  border-color: var(--red);
}
.health-badge-bad .health-dot { background: var(--red); }
.health-badge-new {
  background: var(--gray-light);
  color: var(--gray-dark);
  border-color: var(--border2);
}
.health-badge-new .health-dot { background: var(--text3); }

.primary-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px;
  background: var(--bg2);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  border-left-width: 4px;
  transition: border-color 150ms ease, background-color 150ms ease;
}
.primary-fields.health-good {
  border-left-color: var(--teal);
  background: var(--teal-light);
}
.primary-fields.health-warn {
  border-left-color: var(--amber);
  background: var(--amber-light);
}
.primary-fields.health-bad {
  border-left-color: var(--red);
  background: var(--red-light);
}
.primary-fields.health-new {
  border-left-color: var(--text3);
}
.primary-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.primary-field-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text2);
  font-weight: 600;
}
.primary-field-value {
  font-size: 18px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
@media (max-width: 540px) {
  .primary-fields { grid-template-columns: 1fr; }
}
.summary-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
  font-size: 13px;
}
.summary-table th, .summary-table td {
  text-align: left;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
}
.summary-table th {
  font-weight: 600;
  color: var(--text2);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.fields-block {
  margin-top: 12px;
  padding: 12px;
  background: var(--bg2);
  border-radius: var(--radius);
  display: grid;
  gap: 8px;
}
.field-row {
  display: grid;
  grid-template-columns: 160px 1fr;
  gap: 12px;
  align-items: start;
  font-size: 13px;
}
.field-name {
  font-weight: 600;
  color: var(--text2);
}
.field-value {
  white-space: pre-wrap;
  word-break: break-word;
}
.history-block {
  margin-top: 12px;
  overflow-x: auto;
}
.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.history-table th, .history-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  white-space: nowrap;
}
.history-table th {
  color: var(--text2);
  text-transform: uppercase;
  font-size: 11px;
}
.history-interval-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
}
.history-interval-transition {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.history-interval-arrow {
  color: var(--text2);
}
.history-interval-learning {
  background: var(--amber-light);
  color: var(--amber-dark);
}
.history-interval-review {
  background: var(--teal-light);
  color: var(--teal-dark);
}

.graded-review-effect {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg2);
}
.graded-review-effect-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.graded-review-headline {
  font-size: 13px;
  line-height: 1.35;
  word-break: break-word;
}
.graded-review-dismiss {
  flex-shrink: 0;
}
.graded-review-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px;
  margin-top: 12px;
}
.graded-review-sched-chip {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--gray-light);
  color: var(--text2);
  border: 1px solid var(--border);
}
.graded-review-grade-line {
  font-size: 13px;
  color: var(--text);
  font-weight: 500;
}
.graded-review-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
  font-size: 13px;
}
.graded-review-table th,
.graded-review-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}
.graded-review-table th {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text2);
  font-weight: 600;
}
.graded-review-delta {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-weight: 600;
  color: var(--teal-dark);
}
.graded-review-sched-note {
  margin-top: 14px;
}
.graded-review-sched-table {
  margin-top: 0;
}
.interval-adjust-slider input[type="range"] {
  width: 100%;
}
.interval-adjust-custom {
  margin-top: 12px;
}
.interval-adjust-preview {
  margin-top: 10px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg2);
}
</style>
