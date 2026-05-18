const ANKI_URL = 'http://127.0.0.1:8765'

export async function ankiCall(action, params = {}) {
  const res = await fetch(ANKI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, version: 6, params })
  })
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.result
}

export async function fetchDeckNames() {
  const names = await ankiCall('deckNames')
  return names.sort()
}

async function detectFsrs(deckName) {
  try {
    const config = await ankiCall('getDeckConfig', { deck: deckName })
    if (!config) return false
    if (typeof config.fsrs === 'boolean') return config.fsrs
    if (Array.isArray(config.fsrsParams5) && config.fsrsParams5.length) return true
    if (Array.isArray(config.fsrsWeights) && config.fsrsWeights.length) return true
    return false
  } catch {
    return false
  }
}

function resolveSelectedDecks(allDecks, rootDeck, includeSubdecks) {
  if (!allDecks.includes(rootDeck)) {
    throw new Error(`Deck "${rootDeck}" not found in Anki.`)
  }
  if (!includeSubdecks) return [rootDeck]
  const prefix = rootDeck + '::'
  return [rootDeck, ...allDecks.filter(d => d.startsWith(prefix))].sort()
}

export async function loadAllData(selection, onProgress) {
  const { rootDeck, includeSubdecks } = selection
  if (!rootDeck) throw new Error('No deck selected.')

  onProgress?.({ phase: 'init', message: 'Fetching deck list…' })
  const allDecks = await fetchDeckNames()
  const selectedDecks = resolveSelectedDecks(allDecks, rootDeck, includeSubdecks)

  onProgress?.({ phase: 'stats', message: 'Fetching deck stats…' })
  const [statsResult, reviewsByDay, usesFsrs] = await Promise.all([
    ankiCall('getDeckStats', { decks: selectedDecks }),
    ankiCall('getNumCardsReviewedByDay'),
    detectFsrs(rootDeck)
  ])

  onProgress?.({ phase: 'cards', message: 'Finding cards in each deck…' })
  const deckCardMap = {}
  let allCardIds = []
  for (const deck of selectedDecks) {
    const ids = await ankiCall('findCards', { query: `deck:"${deck}" -deck:"${deck}::*"` })
    deckCardMap[deck] = ids
    allCardIds.push(...ids)
  }
  allCardIds = [...new Set(allCardIds)]

  const cardsInfo = []
  const batchSize = 250
  for (let i = 0; i < allCardIds.length; i += batchSize) {
    const batch = allCardIds.slice(i, i + batchSize)
    const result = await ankiCall('cardsInfo', { cards: batch })
    cardsInfo.push(...result)
    onProgress?.({
      phase: 'details',
      message: `Loading card details…`,
      processed: cardsInfo.length,
      total: allCardIds.length
    })
  }

  return {
    selectedDecks,
    rootDeck,
    includeSubdecks,
    statsResult,
    reviewsByDay,
    deckCardMap,
    cardsInfo,
    allCardIds,
    usesFsrs
  }
}

export async function setEaseFactor(cardIds, easeFactor) {
  return ankiCall('setEaseFactors', {
    cards: cardIds,
    easeFactors: cardIds.map(() => easeFactor)
  })
}

export async function setCardIntervalDays(cardId, days) {
  const safeDays = Math.max(1, Math.round(Number(days) || 1))
  return ankiCall('setDueDate', {
    cards: [cardId],
    // Use exact day assignment; we add our own fuzz before calling this.
    days: `${safeDays}!`
  })
}
