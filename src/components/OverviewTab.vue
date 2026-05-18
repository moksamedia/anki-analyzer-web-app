<script setup>
import { computed } from 'vue'
import Chart from './Chart.vue'
import { intervalBins, easeBins, INTERVAL_LABELS, EASE_LABELS } from '../composables/useAnalysis.js'

const props = defineProps({
  overview: { type: Object, required: true },
  usesFsrs: { type: Boolean, default: false }
})

const metrics = computed(() => [
  { label: 'Total cards', value: props.overview.cardCount.toLocaleString(), sub: `${props.overview.deckCount} decks` },
  { label: 'Due today', value: props.overview.totalDue.toLocaleString(), sub: `+ ${props.overview.totalNew} new` },
  { label: 'Avg interval', value: props.overview.avgInterval + 'd', sub: 'across analyzed cards' },
  { label: 'Avg ease', value: Math.round(props.overview.avgEase / 10) + '%', sub: props.overview.lowEase ? `${props.overview.lowEase} below 200%` : 'all healthy' },
  { label: 'Problem cards', value: props.overview.highLapse.toString(), sub: '5+ lapses' }
])

const intervalData = computed(() => ({
  labels: INTERVAL_LABELS,
  datasets: [{ data: intervalBins(props.overview.intervals), backgroundColor: '#1D9E75', borderRadius: 4 }]
}))

const easeData = computed(() => ({
  labels: EASE_LABELS,
  datasets: [{
    data: easeBins(props.overview.factors),
    backgroundColor: ['#E24B4A', '#EF9F27', '#1D9E75', '#5DCAA5', '#9FE1CB', '#E1F5EE'],
    borderRadius: 4
  }]
}))

const chartOptions = {
  scales: {
    x: { grid: { display: false } },
    y: { beginAtZero: true, ticks: { precision: 0 } }
  }
}
</script>

<template>
  <div class="metrics">
    <div v-for="m in metrics" :key="m.label" class="metric">
      <div class="metric-label">{{ m.label }}</div>
      <div class="metric-value">{{ m.value }}</div>
      <div class="metric-sub">{{ m.sub }}</div>
    </div>
  </div>

  <div class="section-title">Interval distribution</div>
  <Chart
    type="bar"
    :labels="intervalData.labels"
    :datasets="intervalData.datasets"
    :options="chartOptions"
  />

  <div class="section-title">
    Ease factor distribution
    <span v-if="usesFsrs" style="text-transform: none; letter-spacing: 0; color: var(--text2); font-weight: 400; margin-left: 6px;">
      · legacy field, FSRS does not use this for scheduling
    </span>
  </div>
  <Chart
    type="bar"
    :labels="easeData.labels"
    :datasets="easeData.datasets"
    :options="chartOptions"
    height="160px"
  />
</template>
