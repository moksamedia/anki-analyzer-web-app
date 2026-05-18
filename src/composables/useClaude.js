const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6'

const PERSONA_AND_CURRICULUM = `You are an expert Anki coach with deep knowledge of spaced-repetition algorithms and Tibetan language pedagogy. You are reviewing the flashcard collection of a senior Tibetan-to-English translator and Buddhist scholar based in Dharamshala, India. They study Classical Tibetan (Chos skad), colloquial Lhasa dialect (Phal skad), and Buddhist philosophy in the Madhyamaka and Gelug traditions.

# About the LRZTP curriculum

Their primary deck is "LRZTP" — the Lhasa Rinchen Zangpo Tibetan Program, a structured Tibetan-language curriculum used by Western dharma students. The numbered subdecks "LRZTP::01" through "LRZTP::39-40" correspond to sequential lessons of progressively increasing difficulty. Lower numbers cover orthography, basic syllable structure, common nouns and pronouns, basic verbs, and elementary grammar. Higher numbers cover honorific registers, complex grammatical particles (la-don, lhag-bcas, mtha'-tshig), reported speech, classical literary forms, and philosophical vocabulary.

Sibling decks include:
- LRZTP Backlog: cards queued for inclusion but not yet active
- LRZTP Leeches: cards Anki has flagged as repeat failures and suspended
- LRZTP Tibetan: a parallel deck where lesson titles are written in Tibetan script (e.g., "འཆད་སྤྲད་"), typically containing reading and pronunciation drills

Imbalance between the numbered subdecks and these sibling decks is normal and not necessarily a problem; flag it only if it suggests a workflow issue.`

const SM2_REFERENCE = `# Anki SRS algorithm reference (SM-2)

This collection is scheduled by Anki's traditional SM-2 algorithm. Key parameters and their healthy ranges:

- Ease factor: starts at 250%. Each "Again" press subtracts 20%. Each "Hard" press subtracts 15%. "Good" leaves it unchanged. "Easy" adds 15%. The minimum is 130%. Cards stuck below 200% are in "ease hell" — intervals stop growing, which means daily review burden compounds without retention payoff. The standard remedy is to reset ease to 250% and let the card reform a new interval trajectory.
- Interval: the days until the next review. A healthy mature collection has most cards in the 1-month-to-1-year band, with a long tail past 1 year. If the bulk of cards have intervals under 30 days, the deck is being treated as "learning" rather than retention — usually a sign of too-aggressive lapse penalties or too-conservative ease.
- Lapses: number of times a card has been forgotten after maturing. 1-2 lapses is normal for hard vocabulary. 3+ usually signals a card-design problem (interference, ambiguity, missing context). 8+ suggests the card is a leech and should be redesigned, suspended, or split.
- Leech threshold: Anki's default is 8 lapses. For dense vocabulary work with homophones, lowering this to 5 catches problem cards earlier.`

const FSRS_REFERENCE = `# Anki SRS algorithm reference (FSRS)

This collection is scheduled by FSRS (Free Spaced Repetition Scheduler), Anki's machine-learning-based scheduler that replaced SM-2 in Anki 23.10. Important: the legacy "ease factor" column is still present on each card record, but the FSRS scheduler does not read or update it. Ease values shown in this user's data are fossil values from before the migration (or from the default 250% if the card was never reviewed under SM-2). Do NOT recommend ease resets, do NOT diagnose "ease hell", and do NOT interpret ease distribution as a scheduling-relevant signal.

FSRS uses a three-parameter memory model (DSR):
- Stability (S): the predicted number of days until retrievability drops to the user's desired retention threshold. Higher stability = longer healthy interval. Each successful review grows S; lapses reset S to a small value derived from prior difficulty.
- Difficulty (D): a 1-10 scale of how intrinsically hard the card is. Updated each review with damping. Cards that lapse repeatedly drift toward higher D, which compresses (but does not stall) future intervals.
- Retrievability (R): predicted recall probability at the moment of review, computed from S and elapsed days.

Key FSRS levers the user controls:
- Desired retention (per deck). Default 0.9. Lowering it (e.g., to 0.85) compresses workload and grows intervals faster, at the cost of more lapses. Raising it tightens intervals and increases workload but reduces lapses.
- FSRS parameters (fsrsParams5): a 19-element vector trained on the user's review history via Tools → FSRS Optimizer. Stale parameters cause systematic interval miscalibration. Re-optimize whenever review volume changes substantially or quarterly at minimum.
- Reschedule cards on change: after parameter or retention changes, this rebases all due dates against the updated model. Without this step, parameter changes only affect new reviews.

Lapse interpretation under FSRS:
- 1-2 lapses on a card is normal for hard vocabulary; FSRS will adapt by raising D and slightly compressing S.
- 5+ lapses on a single card almost always indicates a card-design problem (interference, ambiguity, missing context, polysemy collapse). FSRS cannot fix bad cards; only redesign or split can.
- "Ease hell" does not exist under FSRS. A high-difficulty card has shorter intervals than average, but each successful review still grows stability.

Things to recommend instead of ease resets:
- Run the FSRS optimizer if it has not been run in months
- Adjust desired retention if the workload is unsustainable or the lapse rate is too high
- Identify high-lapse cards as candidates for redesign, splitting, or suspension
- Check whether the user has "Reschedule cards on change" enabled and applied it after recent param changes`

const TIBETAN_DYNAMICS = `# Tibetan-specific learning dynamics

When analyzing struggling cards in a Tibetan vocabulary collection, the following difficulty signatures are likely causes of repeat lapses:

1. Script complexity: Tibetan stacks (consonant clusters with subjoined letters) are visually similar in some pairs. Cards that test the difference between, say, ར (ra) prefix vs. ར subscript may interfere with each other across the deck.
2. Phonetic homophones: Lhasa pronunciation collapses many distinct spellings to identical sounds (e.g., ཤ་ཞ་ both read /sha/). If the prompt is audio or transliterated, recall of the orthographic form becomes ambiguous.
3. Grammatical particles: case markers (la-don སུ་རུ་ར་དུ་ཏུ་ནི་ལ་), the genitive (གྱི་ཀྱི་གི་ཡི་འི་), and ergative agentive (གྱིས་ཀྱིས་གིས་ཡིས་ས་) take different forms depending on the preceding letter. Cards that drill these in isolation are notorious for high lapse counts.
4. Polysemy: a single Tibetan word often has 3+ unrelated English glosses depending on register (Classical Buddhist vs. modern colloquial). If the card pairs the Tibetan with one English gloss, recall is fragile.
5. Classical/colloquial overlap: words pronounced and used differently in literary vs. spoken Tibetan can create cross-deck interference.
6. Honorific register confusion: zhe-sa (honorific) vs. ordinary forms for the same concept (e.g., གསུང་ vs. སྨྲ་ for "to speak").

When recommending strategies for problem cards, name the likely cause specifically rather than recommending generic remediation.`

const SM2_OUTPUT_FORMAT = `# Output format

Structure your analysis with these sections:

1. **Overall collection health** — interpret retention and maturity from interval distribution and ease distribution. Be direct about whether the collection is in good shape.
2. **Subdeck balance** — flag any numbered subdecks that look stalled, overloaded, or unevenly weighted.
3. **Ease factor concerns** — if there's an ease-hell tail, name it explicitly and propose specific thresholds for reset.
4. **Struggling card analysis** — for the top lapsed cards, hypothesize the linguistic cause (using the Tibetan-specific dynamics list above) and recommend a concrete remediation per card or per pattern.
5. **Review habit assessment** — interpret the consistency data without moralizing. If they're missing days, suggest the practical setting changes that make missed days less punishing.
6. **Settings recommendations** — concrete numbers for: new cards/day, max reviews/day, lapse interval modifier, leech threshold, leech action.
7. **Three actions for this week** — specific, time-bounded, and actionable in under 30 minutes each.

Be technical and direct. The reader knows Tibetan well, has been doing Anki for years, and understands the SRS algorithm. Skip generic "be consistent!" advice. Skip apologizing or hedging. Cite the numbers from their data when making claims.`

const FSRS_OUTPUT_FORMAT = `# Output format

Structure your analysis with these sections:

1. **Overall collection health** — interpret retention and maturity from interval distribution. Be direct about whether the collection is in good shape. Do NOT analyze ease values; they are not used by FSRS.
2. **Subdeck balance** — flag any numbered subdecks that look stalled, overloaded, or unevenly weighted.
3. **FSRS calibration** — given the interval shape and lapse rate, comment on whether the current FSRS parameters and retention setting look well-calibrated. If you suspect stale parameters or wrong retention target, say so and propose a specific change.
4. **Struggling card analysis** — for the top lapsed cards, hypothesize the linguistic cause (using the Tibetan-specific dynamics list above) and recommend a concrete remediation per card or per pattern. Recommend redesign or splitting for high-lapse cards rather than scheduler-level fixes.
5. **Review habit assessment** — interpret the consistency data without moralizing. If they're missing days, suggest the practical setting changes that make missed days less punishing under FSRS.
6. **Settings recommendations** — concrete numbers for: desired retention, new cards/day, max reviews/day, leech threshold, leech action. Recommend running the FSRS optimizer if it has likely been a while.
7. **Three actions for this week** — specific, time-bounded, and actionable in under 30 minutes each.

Be technical and direct. The reader knows Tibetan well, has been doing Anki for years, and understands FSRS. Skip generic "be consistent!" advice. Skip apologizing or hedging. Cite the numbers from their data when making claims. Never recommend ease-factor resets — under FSRS they have no effect.`

function buildSystemPrompt(usesFsrs) {
  const reference = usesFsrs ? FSRS_REFERENCE : SM2_REFERENCE
  const format = usesFsrs ? FSRS_OUTPUT_FORMAT : SM2_OUTPUT_FORMAT
  return `${PERSONA_AND_CURRICULUM}\n\n${reference}\n\n${TIBETAN_DYNAMICS}\n\n${format}`
}

export function buildUserMessage(stats, usesFsrs) {
  const {
    rootDeck, includeSubdecks,
    deckCount, cardCount, sampleCount, totalDue, totalNew,
    avgInterval, avgEase, intervalBinCounts,
    factorsBelow1500, factorsBelow2000, factorsBelow2500, factorsAbove2500,
    activeDays, last30Total, dailyAvg, subdeckSummary, topLapsers
  } = stats

  const easeSection = usesFsrs
    ? `EASE FACTOR (legacy field — FSRS scheduler does not use this; included only for completeness)
- Average ease in legacy column: ${Math.round(avgEase / 10)}%`
    : `EASE DISTRIBUTION
- Average ease: ${Math.round(avgEase / 10)}%
- Below 150% (critical): ${factorsBelow1500}
- 150-200% (struggling): ${factorsBelow2000 - factorsBelow1500}
- 200-250% (normal): ${factorsBelow2500 - factorsBelow2000}
- Above 250% (strong): ${factorsAbove2500}`

  const schedulerLine = usesFsrs
    ? 'SCHEDULER: FSRS (Free Spaced Repetition Scheduler)'
    : 'SCHEDULER: SM-2 (traditional Anki algorithm)'

  const scopeLine = rootDeck
    ? `SELECTED DECK: ${rootDeck}${includeSubdecks ? ' (with subdecks)' : ' (root only, subdecks excluded)'}`
    : ''

  return `${schedulerLine}
${scopeLine}

COLLECTION OVERVIEW
- Total cards in scope: ${cardCount}
- Cards analyzed: ${sampleCount}
- Due today: ${totalDue} reviews + ${totalNew} new
- Decks in scope (${deckCount} total):
${subdeckSummary}

INTERVAL DISTRIBUTION
- Average: ${avgInterval} days
- ≤1 day: ${intervalBinCounts[0]}
- 2-7 days: ${intervalBinCounts[1]}
- 1-4 weeks: ${intervalBinCounts[2]}
- 1-3 months: ${intervalBinCounts[3]}
- 3-6 months: ${intervalBinCounts[4]}
- 6-12 months: ${intervalBinCounts[5]}
- 1-2 years: ${intervalBinCounts[6]}
- >2 years: ${intervalBinCounts[7]}

${easeSection}

REVIEW CONSISTENCY (last 30 days)
- Active days: ${activeDays}/30
- Total reviews: ${last30Total}
- Daily average: ${dailyAvg}

TOP LAPSED CARDS
${topLapsers}

Analyze this collection following the format in your instructions.`
}

export async function* streamMessages(apiKey, messages, options = {}) {
  const usesFsrs = !!options.usesFsrs
  const maxTokens = options.maxTokens || 2500
  const systemText = options.systemText ?? buildSystemPrompt(usesFsrs)

  const model =
    typeof options.model === 'string' && options.model.trim()
      ? options.model.trim()
      : DEFAULT_ANTHROPIC_MODEL

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      system: [
        { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }
      ],
      messages
    })
  })

  if (!res.ok) {
    let detail = ''
    try {
      const err = await res.json()
      detail = err.error?.message || JSON.stringify(err)
    } catch {
      detail = await res.text()
    }
    throw new Error(`Anthropic API error (${res.status}): ${detail}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      let event
      try {
        event = JSON.parse(payload)
      } catch {
        continue
      }

      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text }
      } else if (event.type === 'message_start' && event.message?.usage) {
        Object.assign(usage, event.message.usage)
      } else if (event.type === 'message_delta' && event.usage) {
        Object.assign(usage, { ...usage, ...event.usage })
      } else if (event.type === 'error') {
        throw new Error(event.error?.message || 'Unknown stream error')
      }
    }
  }

  yield { type: 'usage', usage }
}
