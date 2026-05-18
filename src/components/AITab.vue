<script setup>
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  shortenDeckName,
  cardFront,
  intervalBins,
  reviewSummary
} from '../composables/useAnalysis.js'
import { streamMessages, buildUserMessage } from '../composables/useClaude.js'
import { useApiKey, useAnthropicModel } from '../composables/useStorage.js'

marked.setOptions({ gfm: true, breaks: true })

const props = defineProps({
  overview: { type: Object, required: true },
  selectedDecks: { type: Array, required: true },
  rootDeck: { type: String, default: '' },
  includeSubdecks: { type: Boolean, default: true },
  statsResult: { type: Object, required: true },
  deckCardMap: { type: Object, required: true },
  reviewsByDay: { type: Array, required: true },
  usesFsrs: { type: Boolean, default: false }
})

const HISTORY_KEY = 'lrztp_analysis_history_v1'
const LEGACY_KEY = 'lrztp_analysis_v1'
const HISTORY_LIMIT = 20

const apiKey = useApiKey()
const anthropicModelSetting = useAnthropicModel()
const history = ref([])
const selectedId = ref(null)
const streamingText = ref('')
const streamingUsage = ref(null)
const isStreaming = ref(false)
const error = ref('')
const chatInput = ref('')
const isSendingFollowup = ref(false)
const chatScrollAnchor = ref(null)

onMounted(async () => {
  history.value = loadHistory()
  if (history.value.length > 0) {
    selectedId.value = history.value[0].id
  }
})

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed.map(normalizeEntry)
    }
  } catch {}

  const legacy = localStorage.getItem(LEGACY_KEY)
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy)
      if (parsed?.text) {
        const migrated = [normalizeEntry({
          id: parsed.savedAt || newId(),
          savedAt: parsed.savedAt || new Date().toISOString(),
          text: parsed.text,
          usage: parsed.usage || null
        })]
        localStorage.setItem(HISTORY_KEY, JSON.stringify(migrated))
        localStorage.removeItem(LEGACY_KEY)
        return migrated
      }
    } catch {}
  }
  return []
}

function normalizeEntry(entry) {
  return {
    id: entry.id || newId(),
    savedAt: entry.savedAt || new Date().toISOString(),
    text: entry.text || '',
    usage: entry.usage || null,
    userMessage: entry.userMessage || '',
    usesFsrs: entry.usesFsrs ?? false,
    messages: Array.isArray(entry.messages) ? entry.messages : []
  }
}

function persistHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function buildStats() {
  const stats = Object.values(props.statsResult)
  const subdeckSummary = props.selectedDecks.map(deck => {
    const s = stats.find(x => x.name === deck)
    const short = shortenDeckName(deck)
    return s
      ? `  ${short}: ${s.total_in_deck} cards, ${s.review_count + s.learn_count} due, ${s.new_count} new`
      : `  ${short}: ${(props.deckCardMap[deck] || []).length} cards`
  }).join('\n')

  const topLapsers = props.overview.lapseCards.slice(0, 15).map(c => {
    const front = cardFront(c).slice(0, 80) || '(media)'
    const dn = shortenDeckName(c.deckName || '')
    return `  [${dn}] "${front}" — ${c.lapses} lapses, ${Math.round(c.factor / 10)}% ease, ${c.interval}d interval`
  }).join('\n')

  const factors = props.overview.factors
  const review = reviewSummary(props.reviewsByDay, 30)

  return {
    rootDeck: props.rootDeck,
    includeSubdecks: props.includeSubdecks,
    deckCount: props.selectedDecks.length,
    cardCount: props.overview.cardCount,
    sampleCount: props.overview.sampleCount,
    totalDue: props.overview.totalDue,
    totalNew: props.overview.totalNew,
    avgInterval: props.overview.avgInterval,
    avgEase: props.overview.avgEase,
    intervalBinCounts: intervalBins(props.overview.intervals),
    factorsBelow1500: factors.filter(e => e < 1500).length,
    factorsBelow2000: factors.filter(e => e < 2000).length,
    factorsBelow2500: factors.filter(e => e < 2500).length,
    factorsAbove2500: factors.filter(e => e >= 2500).length,
    activeDays: review.activeDays,
    last30Total: review.total,
    dailyAvg: review.dailyAvg,
    subdeckSummary,
    topLapsers
  }
}

async function runAnalysis() {
  const key = apiKey.value.trim()
  if (!key) {
    error.value = 'Please enter your Anthropic API key.'
    return
  }

  isStreaming.value = true
  error.value = ''
  streamingText.value = ''
  streamingUsage.value = null

  const userMessage = buildUserMessage(buildStats(), props.usesFsrs)

  try {
    for await (const chunk of streamMessages(key, [{ role: 'user', content: userMessage }], {
      usesFsrs: props.usesFsrs,
      model: anthropicModelSetting.value
    })) {
      if (chunk.type === 'text') {
        streamingText.value += chunk.text
      } else if (chunk.type === 'usage') {
        streamingUsage.value = chunk.usage
      }
    }

    const entry = normalizeEntry({
      id: newId(),
      savedAt: new Date().toISOString(),
      text: streamingText.value,
      usage: streamingUsage.value,
      userMessage,
      usesFsrs: props.usesFsrs,
      messages: []
    })
    history.value = [entry, ...history.value].slice(0, HISTORY_LIMIT)
    selectedId.value = entry.id
    persistHistory()

    streamingText.value = ''
    streamingUsage.value = null
  } catch (e) {
    error.value = e.message
    streamingText.value = ''
  } finally {
    isStreaming.value = false
  }
}

const currentEntry = computed(() => {
  if (!selectedId.value) return null
  return history.value.find(h => h.id === selectedId.value) || null
})

async function sendFollowup() {
  const text = chatInput.value.trim()
  if (!text) return
  const entry = currentEntry.value
  if (!entry) return
  const key = apiKey.value.trim()
  if (!key) {
    error.value = 'Please enter your Anthropic API key.'
    return
  }
  if (!entry.userMessage) {
    error.value = 'This analysis is missing its original context (legacy entry). Please re-analyze before chatting.'
    return
  }

  isSendingFollowup.value = true
  error.value = ''
  chatInput.value = ''

  entry.messages.push({ role: 'user', text, sentAt: new Date().toISOString() })
  entry.messages.push({ role: 'assistant', text: '', streaming: true })
  await scrollChatToBottom()

  const messages = [
    { role: 'user', content: entry.userMessage },
    { role: 'assistant', content: entry.text }
  ]
  for (let i = 0; i < entry.messages.length - 1; i++) {
    messages.push({ role: entry.messages[i].role, content: entry.messages[i].text })
  }

  const assistantMsg = entry.messages[entry.messages.length - 1]

  try {
    for await (const chunk of streamMessages(key, messages, {
      usesFsrs: entry.usesFsrs ?? props.usesFsrs,
      model: anthropicModelSetting.value
    })) {
      if (chunk.type === 'text') {
        assistantMsg.text += chunk.text
        await scrollChatToBottom()
      } else if (chunk.type === 'usage') {
        assistantMsg.usage = chunk.usage
      }
    }
    delete assistantMsg.streaming
    persistHistory()
  } catch (e) {
    error.value = e.message
    entry.messages.pop()
    entry.messages.pop()
  } finally {
    isSendingFollowup.value = false
  }
}

async function scrollChatToBottom() {
  await nextTick()
  if (chatScrollAnchor.value) {
    chatScrollAnchor.value.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }
}

function onChatKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendFollowup()
  }
}

function clearChatThread() {
  const entry = currentEntry.value
  if (!entry || !entry.messages.length) return
  if (!confirm(`Clear ${entry.messages.length / 2 | 0} chat turn(s) for this analysis? The analysis itself is kept.`)) return
  entry.messages = []
  persistHistory()
}

function deleteCurrent() {
  if (!selectedId.value) return
  if (!confirm('Delete this analysis (and its chat) from history?')) return
  history.value = history.value.filter(h => h.id !== selectedId.value)
  selectedId.value = history.value[0]?.id || null
  persistHistory()
}

function clearAll() {
  if (!history.value.length) return
  if (!confirm(`Delete all ${history.value.length} saved analyses (and their chats)?`)) return
  history.value = []
  selectedId.value = null
  persistHistory()
}

watch(selectedId, () => {
  chatInput.value = ''
  error.value = ''
})

const displayedAnalysis = computed(() => {
  if (isStreaming.value) {
    return {
      text: streamingText.value,
      usage: streamingUsage.value,
      savedAt: null,
      live: true
    }
  }
  if (!currentEntry.value) return null
  return {
    text: currentEntry.value.text,
    usage: currentEntry.value.usage,
    savedAt: currentEntry.value.savedAt,
    live: false
  }
})

function renderMarkdown(text) {
  if (!text) return ''
  return DOMPurify.sanitize(marked.parse(text))
}

const renderedAnalysisHtml = computed(() => renderMarkdown(displayedAnalysis.value?.text || ''))

const savedAtFormatted = computed(() => {
  if (!displayedAnalysis.value?.savedAt) return ''
  return new Date(displayedAnalysis.value.savedAt).toLocaleString()
})

const cacheNote = computed(() => {
  const u = displayedAnalysis.value?.usage
  if (!u) return ''
  const created = u.cache_creation_input_tokens || 0
  const read = u.cache_read_input_tokens || 0
  if (read > 0) return `cache hit · ${read} tokens read from cache`
  if (created > 0) return `cache primed · ${created} tokens cached for next run`
  return ''
})

function formatHistoryLabel(entry, idx) {
  const d = new Date(entry.savedAt)
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const tag = idx === 0 ? ' · latest' : ''
  const chatTag = entry.messages?.length ? ` (${entry.messages.length / 2 | 0} chat)` : ''
  return `${date} ${time}${tag}${chatTag}`
}
</script>

<template>
  <div v-if="!apiKey" class="hint" style="margin-bottom: 1rem;">
    Set your Anthropic API key in the <strong>Settings</strong> tab to enable analysis.
  </div>

  <div class="toolbar">
    <div class="section-title" style="margin: 0;">Personalized suggestions</div>
    <div class="row">
      <button class="btn" @click="runAnalysis" :disabled="isStreaming || isSendingFollowup">
        <span v-if="isStreaming" class="spinner"></span>
        {{ isStreaming ? 'Analyzing…' : (history.length ? 'Re-analyze' : 'Analyze my decks') }}
      </button>
    </div>
  </div>

  <div v-if="history.length && !isStreaming" class="row" style="margin-bottom: 12px; gap: 8px;">
    <label class="metric-sub" style="white-space: nowrap;">History:</label>
    <select v-model="selectedId" class="search-input" style="flex: 1; min-width: 160px;">
      <option
        v-for="(entry, idx) in history"
        :key="entry.id"
        :value="entry.id"
      >{{ formatHistoryLabel(entry, idx) }}</option>
    </select>
    <button class="btn-outline" @click="deleteCurrent" :disabled="!selectedId">
      Delete
    </button>
    <button class="btn-outline" @click="clearAll" :disabled="!history.length">
      Clear all
    </button>
  </div>

  <div v-if="error" class="error" style="display: block;">
    {{ error }}
  </div>

  <div
    v-if="displayedAnalysis?.text"
    class="ai-box ai-md"
    v-html="renderedAnalysisHtml"
  ></div>
  <div
    v-else
    class="ai-box ai-dim"
  >
    <template v-if="isStreaming">Calling Claude — output will appear here as it streams…</template>
    <template v-else-if="!history.length">Enter your API key above, then click "Analyze my decks".</template>
    <template v-else>Select an analysis from the dropdown above, or click Re-analyze.</template>
  </div>

  <div v-if="displayedAnalysis && (displayedAnalysis.savedAt || displayedAnalysis.usage)" class="ai-meta">
    <span v-if="displayedAnalysis.live">Streaming…</span>
    <span v-else-if="displayedAnalysis.savedAt">Saved {{ savedAtFormatted }}</span>
    <span v-if="displayedAnalysis.usage">
      {{ displayedAnalysis.usage.input_tokens }} in · {{ displayedAnalysis.usage.output_tokens }} out
    </span>
    <span v-if="cacheNote">{{ cacheNote }}</span>
  </div>

  <div v-if="currentEntry && !isStreaming" class="chat-section">
    <div class="toolbar">
      <div class="section-title" style="margin: 0;">
        Chat about this analysis
      </div>
      <button
        v-if="currentEntry.messages.length"
        class="btn-outline"
        @click="clearChatThread"
        :disabled="isSendingFollowup"
      >
        Clear chat
      </button>
    </div>

    <div v-if="currentEntry.messages.length" class="chat-thread">
      <div
        v-for="(m, i) in currentEntry.messages"
        :key="i"
        class="chat-message"
        :class="m.role === 'user' ? 'chat-user' : 'chat-assistant'"
      >
        <div class="chat-role">{{ m.role === 'user' ? 'You' : 'Claude' }}</div>
        <div
          v-if="m.role === 'assistant'"
          class="chat-body ai-md"
          v-html="renderMarkdown(m.text)"
        ></div>
        <div v-else class="chat-body chat-user-text">{{ m.text }}</div>
        <div v-if="m.streaming" class="chat-streaming">
          <span class="spinner spinner-dark"></span> streaming…
        </div>
      </div>
      <div ref="chatScrollAnchor"></div>
    </div>

    <div class="chat-input-row">
      <textarea
        v-model="chatInput"
        class="chat-input"
        rows="2"
        :placeholder="currentEntry.userMessage ? 'Ask a follow-up about this analysis… (Enter to send, Shift+Enter for newline)' : 'Re-analyze first to enable chat (this entry predates chat support)'"
        :disabled="isSendingFollowup || !currentEntry.userMessage"
        @keydown="onChatKeydown"
      ></textarea>
      <button
        class="btn"
        @click="sendFollowup"
        :disabled="!chatInput.trim() || isSendingFollowup || !currentEntry.userMessage"
      >
        <span v-if="isSendingFollowup" class="spinner"></span>
        {{ isSendingFollowup ? 'Sending…' : 'Send' }}
      </button>
    </div>
  </div>
</template>
