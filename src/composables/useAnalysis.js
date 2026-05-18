export const INTERVAL_LABELS = ['<1d', '1-7d', '1-4w', '1-3m', '3-6m', '6-12m', '1-2y', '>2y']
export const EASE_LABELS = ['<150%', '150-200%', '200-250%', '250-300%', '300-350%', '>350%']

export function intervalBins(intervals) {
  const bins = [0, 0, 0, 0, 0, 0, 0, 0]
  for (const i of intervals) {
    if (i <= 1) bins[0]++
    else if (i <= 7) bins[1]++
    else if (i <= 30) bins[2]++
    else if (i <= 90) bins[3]++
    else if (i <= 180) bins[4]++
    else if (i <= 365) bins[5]++
    else if (i <= 730) bins[6]++
    else bins[7]++
  }
  return bins
}

export function easeBins(factors) {
  const bins = [0, 0, 0, 0, 0, 0]
  for (const e of factors) {
    if (e < 1500) bins[0]++
    else if (e < 2000) bins[1]++
    else if (e < 2500) bins[2]++
    else if (e < 3000) bins[3]++
    else if (e < 3500) bins[4]++
    else bins[5]++
  }
  return bins
}

export function shortenDeckName(name) {
  return name
    .replace('LRZTP::', '')
    .replace('LRZTP Tibetan::', 'Tib::')
    .replace('LRZTP ', '')
}

export function stripHtml(s) {
  if (!s) return ''
  return String(s).replace(/<[^>]+>/g, '').trim()
}

export function cardFront(card) {
  if (!card?.fields) return ''
  const first = Object.values(card.fields)[0]
  return stripHtml(first?.value || '').slice(0, 200)
}

export function computeOverview(state) {
  const cardsInfo = state.cardsInfo ?? []
  const statsResult = state.statsResult ?? {}
  const allCardIds = state.allCardIds ?? []
  const deckList = state.lrztpDecks ?? state.selectedDecks ?? []
  const intervals = cardsInfo.map(c => c.interval).filter(i => i > 0)
  const factors = cardsInfo.map(c => c.factor).filter(f => f > 0)
  const lapseCards = cardsInfo
    .filter(c => c.lapses > 0)
    .sort((a, b) => b.lapses - a.lapses)

  let totalDue = 0, totalNew = 0
  for (const s of Object.values(statsResult)) {
    totalDue += s.review_count + s.learn_count
    totalNew += s.new_count
  }

  return {
    deckCount: deckList.length,
    cardCount: allCardIds.length,
    sampleCount: cardsInfo.length,
    totalDue,
    totalNew,
    avgInterval: intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0,
    avgEase: factors.length ? Math.round(factors.reduce((a, b) => a + b, 0) / factors.length) : 0,
    lowEase: factors.filter(e => e < 2000).length,
    criticalEase: factors.filter(e => e < 1500).length,
    highLapse: lapseCards.filter(c => c.lapses >= 5).length,
    intervals,
    factors,
    lapseCards
  }
}

export function computeSubdeckBreakdown(deckName, cardsInfo) {
  const cards = cardsInfo.filter(c => c.deckName === deckName)
  const intervals = cards.map(c => c.interval).filter(i => i > 0)
  const factors = cards.map(c => c.factor).filter(f => f > 0)
  return {
    deckName,
    cardCount: cards.length,
    intervalBins: intervalBins(intervals),
    easeBins: easeBins(factors),
    lapseCount: cards.filter(c => c.lapses > 0).length,
    avgInterval: intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0,
    avgEase: factors.length ? Math.round(factors.reduce((a, b) => a + b, 0) / factors.length) : 0
  }
}

export function buildHeatmap(reviewsByDay, days = 90) {
  const cutoff = Date.now() - days * 86400000
  const byDate = {}
  for (const [date, count] of reviewsByDay) {
    if (new Date(date).getTime() >= cutoff) byDate[date] = count
  }
  const max = Math.max(...Object.values(byDate), 1)

  const grid = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000)
    const key = d.toISOString().slice(0, 10)
    const count = byDate[key] || 0
    let level = 0
    if (count > 0) {
      if (count < max * 0.25) level = 1
      else if (count < max * 0.5) level = 2
      else if (count < max * 0.75) level = 3
      else level = 4
    }
    grid.push({ key, count, level })
  }
  return grid
}

export function reviewSummary(reviewsByDay, days = 30) {
  const cutoff = Date.now() - days * 86400000
  const recent = reviewsByDay.filter(([d]) => new Date(d).getTime() >= cutoff)
  const total = recent.reduce((s, [, c]) => s + c, 0)
  const activeDays = recent.filter(([, c]) => c > 0).length
  return { total, activeDays, dailyAvg: Math.round(total / days) }
}
