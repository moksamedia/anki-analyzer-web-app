// HTTP client + per-card prompts for the anki-ai-bridge addon (http://127.0.0.1:8766).

const BRIDGE_URL = 'http://127.0.0.1:8766'

async function bridgeCall(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } }
  if (body !== undefined) opts.body = JSON.stringify(body)
  let res
  try {
    res = await fetch(`${BRIDGE_URL}${path}`, opts)
  } catch {
    throw new Error(`Bridge unreachable on ${BRIDGE_URL}. Is the anki-ai-bridge addon loaded in Anki?`)
  }
  let payload = null
  try { payload = await res.json() } catch {}
  if (!res.ok) {
    const detail = payload?.error ?? res.statusText
    throw new Error(`Bridge ${method} ${path} failed (${res.status}): ${detail}`)
  }
  return payload
}

export const bridge = {
  health: () => bridgeCall('GET', '/health'),
  decks: () => bridgeCall('GET', '/decks'),
  currentCard: () => bridgeCall('GET', '/current-card'),
  card: (id) => bridgeCall('GET', `/card/${id}`),
  deckSummary: (id) => bridgeCall('GET', `/deck/${id}/summary`),
  refreshDeckSummary: (id) => bridgeCall('POST', `/deck/${id}/refresh`, {})
}

// --- summary table rows (rendered as HTML by the component) -------------

function bandLowerBetter(value, p) {
  if (value == null || !p) return null
  if (value <= (p.p25 ?? value)) return 'best 25% (low)'
  if (value <= (p.p50 ?? value)) return '25–50%'
  if (value <= (p.p75 ?? value)) return '50–75% (above median)'
  if (value <= (p.p95 ?? value)) return 'top 25% (high)'
  return 'top 5% (worst)'
}

function bandHigherBetter(value, p) {
  if (value == null || !p) return null
  if (value < (p.p25 ?? value)) return 'bottom 25% (worst)'
  if (value < (p.p50 ?? value)) return '25–50%'
  if (value < (p.p75 ?? value)) return '50–75%'
  if (value < (p.p95 ?? value)) return '75–95%'
  return 'top 5% (best)'
}

function fmt(value, suffix = '', digits = null) {
  if (value == null) return '—'
  if (digits != null && typeof value === 'number') return value.toFixed(digits) + suffix
  return value + suffix
}

export function buildSummaryRows(cardCtx, deckSummary) {
  const card = cardCtx?.card ?? {}
  const sched = cardCtx?.scheduling ?? {}
  const pIvl = deckSummary?.interval_percentiles_days || {}
  const pEase = deckSummary?.ease_percentiles_pct || {}
  const pLapse = deckSummary?.lapse_percentiles || {}
  const fsrsStats = deckSummary?.fsrs_card_stats || {}
  const pDiff = fsrsStats?.difficulty_percentiles || {}
  const pStab = fsrsStats?.stability_percentiles_days || {}

  const rows = []
  if (sched.scheduler === 'fsrs') {
    rows.push({
      label: 'Difficulty (FSRS D)',
      value: fmt(sched.difficulty, ' / 10', 1),
      rank: bandLowerBetter(sched.difficulty, pDiff) ?? '—'
    })
    rows.push({
      label: 'Predicted memory (stability)',
      value: fmt(sched.stability_days, ' days', 1),
      rank: bandHigherBetter(sched.stability_days, pStab) ?? '—'
    })
    if (sched.desired_retention != null) {
      const pct = sched.desired_retention <= 1 ? sched.desired_retention * 100 : sched.desired_retention
      rows.push({ label: 'Target retention', value: fmt(Math.round(pct), '%'), rank: '—' })
    }
  } else {
    rows.push({
      label: 'Ease factor',
      value: fmt(card.ease_factor_pct, '%', 0),
      rank: bandHigherBetter(card.ease_factor_pct, pEase) ?? '—'
    })
  }
  rows.push({
    label: 'Current interval',
    value: fmt(card.ivl_days, ' days'),
    rank: bandHigherBetter(card.ivl_days, pIvl) ?? '—'
  })
  rows.push({
    label: 'Lapses',
    value: fmt(card.lapses),
    rank: bandLowerBetter(card.lapses, pLapse) ?? '—'
  })
  rows.push({ label: 'Reps', value: fmt(card.reps), rank: '—' })
  return rows
}

// --- per-card prompts ---------------------------------------------------

const CARD_SYSTEM_PROMPT = `You are an expert Anki coach embedded in the user's reviewer. They have just shown the answer for a card and want your help diagnosing and improving how they learn that specific card. You have access to the card's note fields, scheduling state, full review history, sibling cards, and a compact summary of the surrounding deck for background context.

# About the user and their collection

The user is a senior Tibetan-to-English translator and Buddhist scholar based in Dharamshala, India. They study Classical Tibetan (Chos skad), colloquial Lhasa dialect (Phal skad), and Buddhist philosophy in the Madhyamaka and Gelug traditions. Their primary deck is "LRZTP" — the Lhasa Rinchen Zangpo Tibetan Program. Numbered subdecks "LRZTP::01" through "LRZTP::39-40" correspond to sequential lessons of progressively increasing difficulty. The reader knows Tibetan well, has been using Anki for years, and understands SRS algorithms — skip generic "be consistent!" advice and skip apologizing or hedging.

# Anki SRS reference

If the card's scheduling.scheduler is "fsrs":
- Stability (S) is the predicted days until retrievability drops to the desired retention threshold. Each successful review grows S; lapses reset S.
- Difficulty (D) is on a 1-10 scale of how intrinsically hard the card is. Repeated lapses drift D higher.
- The legacy ease_factor_pct on the card is a fossil under FSRS — do not recommend ease resets, do not diagnose "ease hell".
- Levers: desired retention (per deck), FSRS parameters, reschedule-cards-on-change.

If "sm2":
- Ease factor starts at 250%, drops 20% per "Again", 15% per "Hard". Cards below 200% are in "ease hell".
- Lapses: 1-2 normal, 3+ signals card-design problem, 8+ leech.

# Tibetan-specific difficulty signatures

Prefer linguistic explanations over generic remediation:
1. Script complexity — Tibetan stacks with subjoined letters look alike; cards across the deck can interfere.
2. Phonetic homophones — Lhasa pronunciation collapses distinct spellings (ཤ་ཞ་ both /sha/).
3. Grammatical particles — la-don (སུ་རུ་ར་དུ་ཏུ་ནི་ལ་), genitive (གྱི་ཀྱི་གི་ཡི་འི་), ergative (གྱིས་ཀྱིས་གིས་ཡིས་ས་) take different forms by preceding letter.
4. Polysemy — one Tibetan word with 3+ unrelated glosses across Classical Buddhist vs. modern colloquial registers.
5. Classical/colloquial overlap — words used differently in literary vs. spoken Tibetan create cross-deck interference.
6. Honorific register confusion — zhe-sa (honorific) vs. ordinary forms (e.g., གསུང་ vs. སྨྲ་).

# Your task on each new card

Structure the initial response as:

1. **One-line card health.** Combine the FSRS/SM-2 state, lapse count, and the deck's percentile placement into a single sentence.
2. **Likely failure mode.** Read the review history and the field contents and name the most specific hypothesis for why this card is hard. Cite the Tibetan-specific signatures by name if relevant.
3. **Concrete next steps.** 2-3 specific actions: a card-redesign suggestion, a setting tweak, a complementary card to add, or "suspend this and replace it with X." Each should be actionable in under 5 minutes.

Keep the initial response under 300 words. Then wait for follow-up questions. For follow-up turns, answer directly without re-summarizing the card. Cite specific numbers from the context.`

export function buildCardSystemPrompt() {
  return CARD_SYSTEM_PROMPT
}

export const DEFAULT_CARD_USER_PROMPT = `I am reviewing this card right now and just revealed the answer.
Give me your initial diagnosis following the structure in your instructions.`

export function buildCardUserMessage(cardCtx, deckSummary, enrichmentMarkdown = '', userPrompt = DEFAULT_CARD_USER_PROMPT) {
  const intro = (userPrompt || DEFAULT_CARD_USER_PROMPT).trim()
  const parts = [
    intro,
    '',
    '## Card under review',
    '```json',
    JSON.stringify(cardCtx, null, 2),
    '```',
    '',
    '## Deck-level background context (from bridge)',
    '```json',
    JSON.stringify(deckSummary, null, 2),
    '```'
  ]
  if (enrichmentMarkdown && enrichmentMarkdown.trim()) {
    parts.push('', enrichmentMarkdown.trim())
  }
  return parts.join('\n')
}

// Returns true if the loaded deck contains the card's deck (same or ancestor with subdecks).
export function loadedDeckCoversCard(loadedDeck, includeSubdecks, cardDeck) {
  if (!loadedDeck || !cardDeck) return false
  if (cardDeck === loadedDeck) return true
  if (!includeSubdecks) return false
  return cardDeck.startsWith(loadedDeck + '::')
}
