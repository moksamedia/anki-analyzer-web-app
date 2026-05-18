<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  Chart as ChartJS,
  BarController, BarElement,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale,
  Tooltip, Filler
} from 'chart.js'

ChartJS.register(
  BarController, BarElement,
  LineController, LineElement, PointElement,
  CategoryScale, LinearScale,
  Tooltip, Filler
)

const props = defineProps({
  type: { type: String, required: true },
  labels: { type: Array, required: true },
  datasets: { type: Array, required: true },
  options: { type: Object, default: () => ({}) },
  height: { type: String, default: '200px' }
})

const canvasRef = ref(null)
let chart = null

function build() {
  if (!canvasRef.value) return
  if (chart) chart.destroy()
  chart = new ChartJS(canvasRef.value, {
    type: props.type,
    data: { labels: props.labels, datasets: props.datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      ...props.options
    }
  })
}

onMounted(build)
onBeforeUnmount(() => { if (chart) chart.destroy() })
watch(() => [props.labels, props.datasets, props.type], build, { deep: true })
</script>

<template>
  <div class="chart-wrap" :style="{ height }">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>
