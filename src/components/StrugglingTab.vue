<script setup>
import { ref, computed, watch } from 'vue'
import { shortenDeckName, cardFront } from '../composables/useAnalysis.js'
import { setEaseFactor } from '../composables/useAnki.js'

const props = defineProps({
  lapseCards: { type: Array, required: true },
  usesFsrs: { type: Boolean, default: false }
})

const PAGE_SIZE = 50

const search = ref('')
const minLapses = ref(1)
const currentPage = ref(1)
const showResetModal = ref(false)
const resetThreshold = ref(2000)
const resetTarget = ref(2500)
const resetting = ref(false)
const resetMessage = ref('')

const filteredAll = computed(() => {
  const q = search.value.trim().toLowerCase()
  return props.lapseCards.filter(c => {
    if (c.lapses < minLapses.value) return false
    if (!q) return true
    const front = cardFront(c).toLowerCase()
    const deck = (c.deckName || '').toLowerCase()
    return front.includes(q) || deck.includes(q)
  })
})

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredAll.value.length / PAGE_SIZE))
)

const paginated = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredAll.value.slice(start, start + PAGE_SIZE)
})

const rangeLabel = computed(() => {
  if (!filteredAll.value.length) return ''
  const start = (currentPage.value - 1) * PAGE_SIZE + 1
  const end = Math.min(start + PAGE_SIZE - 1, filteredAll.value.length)
  return `${start}–${end} of ${filteredAll.value.length}`
})

watch([search, minLapses], () => { currentPage.value = 1 })
watch(totalPages, (n) => {
  if (currentPage.value > n) currentPage.value = n
})

function prevPage() { if (currentPage.value > 1) currentPage.value-- }
function nextPage() { if (currentPage.value < totalPages.value) currentPage.value++ }

const lapseClass = (n) => n >= 10 ? 'b-red' : n >= 5 ? 'b-amber' : 'b-gray'
const easeClass = (f) => f < 1500 ? 'b-red' : f < 2000 ? 'b-amber' : 'b-teal'

function exportLeeches() {
  const rows = [
    ['deck', 'lapses', 'ease', 'interval_days', 'card_id', 'front']
  ]
  for (const c of props.lapseCards) {
    rows.push([
      c.deckName || '',
      c.lapses,
      Math.round(c.factor / 10) + '%',
      c.interval,
      c.cardId,
      cardFront(c).replace(/"/g, '""')
    ])
  }
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `lrztp-leeches-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const resetCandidates = computed(() =>
  props.lapseCards.filter(c => c.factor > 0 && c.factor < resetThreshold.value)
)

async function confirmReset() {
  resetting.value = true
  resetMessage.value = ''
  try {
    const ids = resetCandidates.value.map(c => c.cardId)
    if (!ids.length) {
      resetMessage.value = 'No cards match the threshold.'
    } else {
      await setEaseFactor(ids, resetTarget.value)
      resetMessage.value = `Reset ease on ${ids.length} cards to ${resetTarget.value / 10}%. Reload to see updated stats.`
    }
  } catch (e) {
    resetMessage.value = `Error: ${e.message}`
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <div class="toolbar">
    <div class="section-title" style="margin: 0;">
      Highest lapse cards · {{ rangeLabel || '0 of ' + lapseCards.length }}
    </div>
    <div class="row">
      <button class="btn-outline" @click="exportLeeches" :disabled="!lapseCards.length">
        Export CSV
      </button>
      <button
        class="btn-outline"
        @click="showResetModal = true"
        :disabled="!lapseCards.length || usesFsrs"
        :title="usesFsrs ? 'Disabled: FSRS does not use the ease factor for scheduling' : ''"
      >
        Reset ease… <span v-if="usesFsrs" style="opacity: 0.6;">(SM-2 only)</span>
      </button>
    </div>
  </div>

  <div class="search-row">
    <input
      v-model="search"
      class="search-input"
      placeholder="Search front text or deck name…"
    />
    <select v-model.number="minLapses" class="search-input" style="flex: 0 0 auto;">
      <option :value="1">1+ lapses</option>
      <option :value="3">3+ lapses</option>
      <option :value="5">5+ lapses</option>
      <option :value="10">10+ lapses</option>
    </select>
  </div>

  <div v-if="!lapseCards.length" class="no-data">
    No cards with lapses — great work!
  </div>
  <div v-else-if="!filteredAll.length" class="no-data">
    No cards match the current filter.
  </div>
  <div v-else>
    <div v-for="c in paginated" :key="c.cardId" class="card-item">
      <div class="card-front">{{ cardFront(c) || '(media card)' }}</div>
      <div class="badges">
        <span class="badge b-gray">{{ shortenDeckName(c.deckName || '') }}</span>
        <span class="badge" :class="lapseClass(c.lapses)">{{ c.lapses }} lapses</span>
        <span class="badge" :class="easeClass(c.factor)">{{ Math.round(c.factor / 10) }}% ease</span>
        <span class="badge b-gray">{{ c.interval }}d</span>
      </div>
    </div>

    <div v-if="totalPages > 1" class="pagination">
      <button class="btn-outline" @click="prevPage" :disabled="currentPage === 1">
        ← Prev
      </button>
      <span class="page-info">Page {{ currentPage }} of {{ totalPages }}</span>
      <button class="btn-outline" @click="nextPage" :disabled="currentPage === totalPages">
        Next →
      </button>
    </div>
  </div>

  <div v-if="showResetModal" class="modal-backdrop" @click.self="showResetModal = false">
    <div class="modal">
      <h2>Reset ease factor</h2>
      <p>
        This calls AnkiConnect's <code>setEaseFactors</code> on every card whose ease is below the threshold.
        It does not change cards' interval directly — Anki will reform a new trajectory on the next review.
      </p>
      <p>
        <strong>This action is destructive and cannot be undone from this tool.</strong>
        Make sure you have a backup of your collection first (File → Backups in Anki).
      </p>

      <div class="row" style="margin: 12px 0;">
        <label style="font-size: 13px;">Reset cards with ease below</label>
        <select v-model.number="resetThreshold" class="search-input" style="flex: 0 0 auto;">
          <option :value="1500">150%</option>
          <option :value="1700">170%</option>
          <option :value="2000">200%</option>
          <option :value="2300">230%</option>
        </select>
      </div>

      <div class="row" style="margin: 12px 0;">
        <label style="font-size: 13px;">Reset to</label>
        <select v-model.number="resetTarget" class="search-input" style="flex: 0 0 auto;">
          <option :value="2300">230%</option>
          <option :value="2500">250% (default)</option>
          <option :value="2700">270%</option>
        </select>
      </div>

      <p style="font-size: 12px; color: var(--text2);">
        {{ resetCandidates.length }} cards in the current sample match this threshold.
      </p>

      <div v-if="resetMessage" class="hint" style="color: var(--text); margin-top: 12px;">
        {{ resetMessage }}
      </div>

      <div class="modal-actions">
        <button class="btn-outline" @click="showResetModal = false" :disabled="resetting">
          Cancel
        </button>
        <button class="btn-danger" @click="confirmReset" :disabled="resetting || !resetCandidates.length">
          <span v-if="resetting" class="spinner"></span>
          Reset {{ resetCandidates.length }} cards
        </button>
      </div>
    </div>
  </div>
</template>
