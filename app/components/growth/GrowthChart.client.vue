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
const option = computed(() => growthChartOption(props.view, colorMode.value === 'dark', Boolean(props.family)))
const zoom = ref(100)
function setZoom(value: number) {
  zoom.value = Math.max(10, Math.min(100, value))
  chart.value?.dispatchAction({ type: 'dataZoom', start: 100 - zoom.value, end: 100 })
}
</script>

<template>
  <div>
    <div
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
