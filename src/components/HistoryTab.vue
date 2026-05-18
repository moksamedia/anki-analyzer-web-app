<script setup>
import { computed } from 'vue'
import Chart from './Chart.vue'
import { buildHeatmap } from '../composables/useAnalysis.js'

const props = defineProps({
  reviewsByDay: { type: Array, required: true }
})

const grid = computed(() => buildHeatmap(props.reviewsByDay, 90))

const last30 = computed(() => grid.value.slice(-30))

const lineData = computed(() => ({
  labels: last30.value.map(d => d.key.slice(5)),
  datasets: [{
    data: last30.value.map(d => d.count),
    borderColor: '#1D9E75',
    backgroundColor: 'rgba(29, 158, 117, 0.1)',
    fill: true,
    tension: 0.3,
    pointRadius: 3,
    pointBackgroundColor: '#1D9E75'
  }]
}))

const lineOptions = {
  scales: {
    x: { grid: { display: false }, ticks: { maxRotation: 45, autoSkip: true, maxTicksLimit: 10 } },
    y: { beginAtZero: true, ticks: { precision: 0 } }
  }
}
</script>

<template>
  <div class="section-title">Daily reviews — last 90 days</div>
  <div class="streak-grid">
    <div
      v-for="day in grid"
      :key="day.key"
      class="sd"
      :class="day.level ? 'sd' + day.level : ''"
      :title="`${day.key}: ${day.count} reviews`"
    ></div>
  </div>

  <div class="section-title">Last 30 days</div>
  <Chart
    type="line"
    :labels="lineData.labels"
    :datasets="lineData.datasets"
    :options="lineOptions"
    height="180px"
  />
</template>
