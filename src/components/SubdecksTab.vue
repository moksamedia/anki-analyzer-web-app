<script setup>
import { ref, computed } from 'vue'
import Chart from './Chart.vue'
import {
  shortenDeckName,
  computeSubdeckBreakdown,
  INTERVAL_LABELS,
  EASE_LABELS
} from '../composables/useAnalysis.js'

const props = defineProps({
  selectedDecks: { type: Array, required: true },
  statsResult: { type: Object, required: true },
  deckCardMap: { type: Object, required: true },
  cardsInfo: { type: Array, required: true },
  usesFsrs: { type: Boolean, default: false }
})

const expanded = ref(null)

const rows = computed(() => {
  const stats = Object.values(props.statsResult)
  const max = Math.max(...props.selectedDecks.map(d => {
    const s = stats.find(s => s.name === d)
    return s ? s.total_in_deck : (props.deckCardMap[d] || []).length
  }), 1)

  return props.selectedDecks.map(deck => {
    const s = stats.find(s => s.name === deck)
    const total = s ? s.total_in_deck : (props.deckCardMap[deck] || []).length
    const due = s ? s.review_count + s.learn_count : 0
    const newC = s ? s.new_count : 0
    return {
      deck,
      shortName: shortenDeckName(deck),
      total,
      due,
      newC,
      pct: Math.round(total / max * 100)
    }
  })
})

function toggle(deck) {
  expanded.value = expanded.value === deck ? null : deck
}

const breakdown = computed(() => {
  if (!expanded.value) return null
  return computeSubdeckBreakdown(expanded.value, props.cardsInfo)
})

const chartOptions = {
  scales: {
    x: { grid: { display: false } },
    y: { beginAtZero: true, ticks: { precision: 0 } }
  }
}
</script>

<template>
  <div class="section-title">Per-subdeck breakdown · click a row for interval and ease detail</div>
  <div>
    <template v-for="row in rows" :key="row.deck">
      <div
        class="subdeck-row"
        :class="{ expanded: expanded === row.deck }"
        @click="toggle(row.deck)"
      >
        <div class="subdeck-name" :title="row.deck">{{ row.shortName }}</div>
        <div class="bar-wrap">
          <div class="bar-bg"><div class="bar-fill" :style="{ width: row.pct + '%' }"></div></div>
          <div class="bar-label">{{ row.total }} cards</div>
        </div>
        <div class="badges">
          <span class="badge b-teal">{{ row.due }} due</span>
          <span class="badge b-purple">{{ row.newC }} new</span>
        </div>
      </div>

      <div v-if="expanded === row.deck && breakdown" class="subdeck-detail">
        <div v-if="breakdown.cardCount === 0" class="no-data">
          No card details loaded for this subdeck.
        </div>
        <template v-else>
          <div class="row" style="margin-bottom: 12px; gap: 16px;">
            <div><span class="metric-sub">Avg interval</span><br><strong>{{ breakdown.avgInterval }}d</strong></div>
            <div><span class="metric-sub">Avg ease</span><br><strong>{{ Math.round(breakdown.avgEase / 10) }}%</strong></div>
            <div><span class="metric-sub">Cards with lapses</span><br><strong>{{ breakdown.lapseCount }}</strong></div>
          </div>
          <div class="section-title">Intervals</div>
          <Chart
            type="bar"
            :labels="INTERVAL_LABELS"
            :datasets="[{ data: breakdown.intervalBins, backgroundColor: '#1D9E75', borderRadius: 3 }]"
            :options="chartOptions"
            height="140px"
          />
          <div class="section-title">
            Ease factors
            <span v-if="usesFsrs" style="text-transform: none; letter-spacing: 0; color: var(--text2); font-weight: 400; margin-left: 6px;">
              · legacy, ignored by FSRS
            </span>
          </div>
          <Chart
            type="bar"
            :labels="EASE_LABELS"
            :datasets="[{ data: breakdown.easeBins, backgroundColor: ['#E24B4A','#EF9F27','#1D9E75','#5DCAA5','#9FE1CB','#E1F5EE'], borderRadius: 3 }]"
            :options="chartOptions"
            height="140px"
          />
        </template>
      </div>
    </template>
  </div>
</template>
