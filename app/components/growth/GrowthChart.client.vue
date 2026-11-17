<script setup lang="ts">
import VChart from 'vue-echarts'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { LineChart } from 'echarts/charts'
import { AriaComponent, DataZoomComponent, GridComponent, TooltipComponent } from 'echarts/components'
import type { ChartView, FamilyChartView } from '#shared/utils/chart-data'
import { growthChartOption } from '~/utils/growth-chart-option'

use([CanvasRenderer, LineChart, AriaComponent, DataZoomComponent, GridComponent, TooltipComponent])
const props = defineProps<{ view: ChartView | FamilyChartView, family?: boolean }>()
const colorMode = useColorMode()
const chart = ref<InstanceType<typeof VChart> | null>(null)
const compact = ref(false)
const option = computed(() => growthChartOption(props.view, colorMode.value === 'dark', Boolean(props.family), compact.value))
const zoom = ref(100)
let releaseWidth: (() => void) | undefined
function setZoom(value: number) {
  zoom.value = Math.max(10, Math.min(100, value))
  chart.value?.dispatchAction({ type: 'dataZoom', start: 100 - zoom.value, end: 100 })
}
function setRange(months: number) {
  const start = props.view.curves[0]?.data[0]?.[0] ?? 0
  const end = props.view.curves[0]?.data.at(-1)?.[0] ?? start
  const current = props.view.points.at(-1)?.x ?? start
  const radius = months * 30.4375 / 2
  const low = Math.max(start, current - radius)
  const high = Math.min(end, current + radius)
  chart.value?.dispatchAction({ type: 'dataZoom', startValue: low, endValue: high })
}
onMounted(() => {
  const width = window.matchMedia('(max-width: 639px)')
  compact.value = width.matches
  const update = () => { compact.value = width.matches }
  width.addEventListener('change', update)
  releaseWidth = () => width.removeEventListener('change', update)
})
onUnmounted(() => releaseWidth?.())
</script>

<template>
  <div>
    <div v-if="compact && view.xUnit === 'DAY'" class="mb-2 flex gap-2" role="group" aria-label="Rango del gráfico">
      <UButton variant="outline" class="min-h-11" @click="setRange(6)">6 m</UButton>
      <UButton variant="outline" class="min-h-11" @click="setRange(12)">1 a</UButton>
      <UButton variant="outline" class="min-h-11" @click="setZoom(100)">Todo</UButton>
    </div>
    <div
      v-if="!compact"
      class="mb-2 flex flex-wrap gap-2"
      role="group"
      aria-label="Controles de zoom del gráfico"
    >
      <UButton
        variant="outline"
        class="min-h-11"
        aria-label="Acercar gráfico"
        @click="setZoom(zoom / 2)"
      >
        Acercar
      </UButton>
      <UButton
        variant="outline"
        class="min-h-11"
        aria-label="Alejar gráfico"
        @click="setZoom(zoom * 2)"
      >
        Alejar
      </UButton>
      <UButton
        variant="outline"
        class="min-h-11"
        @click="setZoom(100)"
      >
        Restablecer zoom
      </UButton>
    </div>
    <VChart
      ref="chart"
      :option="option"
      autoresize
      class="w-full"
      style="height: 320px"
      aria-label="Gráfico de crecimiento; consulte la tabla para los valores"
    />
  </div>
</template>
