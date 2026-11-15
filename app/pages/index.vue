<script setup lang="ts">
import type { Appointment } from '#shared/types/scheduling'
import type { FamilyChildSummary } from '../../server/services/invitations'

const { data: navigation } = await useFetch<{ label: string, to: string }[]>('/api/auth/navigation')
const isDoctor = computed(() => Boolean(navigation.value?.some(item => item.to === '/pacientes')))
const isParent = computed(() => Boolean(navigation.value?.some(item => item.to === '/')) && !isDoctor.value)
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const { data: appointments, error, refresh } = await useFetch<Appointment[]>('/api/agenda', { query: { from: today, to: today }, immediate: isDoctor.value, default: () => [] })
const { data: growthReview, error: growthError, refresh: refreshGrowth } = await useFetch<{ id: string }[]>('/api/clinical/crecimiento-por-revisar', { immediate: isDoctor.value, default: () => [] })
const active = computed(() => appointments.value?.filter(item => item.status !== 'CANCELLED') ?? [])
const upcoming = computed(() => active.value.filter(item => item.status !== 'ATTENDED' && new Date(`${item.date}T${item.time}:00-05:00`) >= new Date()))
const { data: children, error: childrenError, refresh: refreshChildren } = await useFetch<FamilyChildSummary[]>('/api/hijos', { immediate: isParent.value, default: () => [] })
const dateFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Guayaquil' })
const dateTimeFormat = new Intl.DateTimeFormat('es-EC', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'America/Guayaquil' })
const weightFormat = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const sizeFormat = new Intl.NumberFormat('es-EC', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
function age(birthDate: string) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Guayaquil', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now)
  const year = Number(parts.find(part => part.type === 'year')?.value)
  const month = Number(parts.find(part => part.type === 'month')?.value)
  const day = Number(parts.find(part => part.type === 'day')?.value)
  const [bornYear, bornMonth, bornDay] = birthDate.split('-').map(Number)
  const months = (year - bornYear!) * 12 + month - bornMonth! - (day < bornDay! ? 1 : 0)
  return months < 12 ? `${months} meses` : `${Math.floor(months / 12)} años ${months % 12} meses`
}
</script>

<template>
  <UContainer class="max-w-6xl space-y-6 py-8 pb-24">
    <template v-if="isDoctor">
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p class="text-sm text-muted">
            Consulta clínica
          </p>
          <h1 class="text-2xl font-semibold">
            Inicio
          </h1>
        </div>
        <UButton
          to="/pacientes/nuevo"
          icon="i-lucide-plus"
          size="lg"
        >
          Nuevo paciente
        </UButton>
      </div>
      <UCard>
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-lg font-semibold">
            Hoy
          </h2><UButton
            to="/agenda?vista=dia"
            variant="link"
          >
            Ver agenda completa
          </UButton>
        </div>
        <UAlert
          v-if="error"
          color="error"
          title="No se pudo cargar la agenda"
          :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
        />
        <dl
          v-else
          class="mt-3 grid grid-cols-3 gap-2 text-center tabular-nums"
        >
          <div>
            <dt class="text-sm text-muted">
              Citas
            </dt><dd class="text-xl font-semibold">
              {{ active.length }}
            </dd>
          </div><div>
            <dt class="text-sm text-muted">
              Por confirmar
            </dt><dd class="text-xl font-semibold">
              {{ active.filter(item => item.status === 'PENDING').length }}
            </dd>
          </div><div>
            <dt class="text-sm text-muted">
              Atendido
            </dt><dd class="text-xl font-semibold">
              {{ active.filter(item => item.status === 'ATTENDED').length }}
            </dd>
          </div>
        </dl>
      </UCard>
      <UCard>
        <h2 class="text-lg font-semibold">
          Próximas citas
        </h2>
        <p
          v-if="!upcoming.length"
          class="mt-2 text-sm text-muted"
        >
          Sin próximas citas hoy.
        </p>
        <ul
          v-else
          class="mt-2 divide-y divide-default"
        >
          <li
            v-for="item in upcoming"
            :key="item.id"
            class="flex flex-wrap items-center gap-2 py-2 text-sm"
          >
            <strong class="tabular-nums">{{ item.time }}</strong><NuxtLink
              v-if="item.patientId"
              :to="`/pacientes/${item.patientId}`"
              class="font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
            >{{ item.name }}</NuxtLink><span
              v-else
              class="font-semibold"
            >{{ item.name }}</span><span class="text-muted">{{ item.birthDate ? age(item.birthDate) : 'Edad no registrada' }} · {{ item.lastWeightKg !== undefined ? `${weightFormat.format(item.lastWeightKg)} kg` : 'Peso no registrado' }}</span><span v-if="item.reason">{{ item.reason }}</span>
          </li>
        </ul>
      </UCard>
      <UCard>
        <h2 class="text-lg font-semibold">
          Mis pacientes
        </h2>
        <ul class="mt-2 divide-y divide-default">
          <li class="flex min-h-12 items-center justify-between gap-2 text-sm">
            <span>Vacunación por revisar</span><span class="text-muted">No disponible aún</span>
          </li>
          <li class="flex min-h-12 items-center justify-between gap-2 text-sm">
            <NuxtLink
              to="/pacientes/crecimiento-por-revisar"
              class="text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
            >Crecimiento por revisar</NuxtLink><span
              v-if="growthError"
              class="text-sm text-muted"
            ><UButton
              variant="link"
              @click="refreshGrowth()"
            >Reintentar</UButton></span><strong
              v-else
              class="tabular-nums"
            >{{ growthReview?.length ?? 0 }}</strong>
          </li>
          <li class="flex min-h-12 items-center justify-between gap-2 text-sm">
            <span>Controles pendientes</span><span class="text-muted">No disponible aún</span>
          </li>
        </ul>
      </UCard>
    </template>
    <template v-else-if="isParent">
      <h1 class="text-2xl font-semibold">
        Mis hijos
      </h1>
      <UAlert
        v-if="childrenError"
        color="error"
        variant="soft"
        title="No se pudieron consultar los datos"
        :actions="[{ label: 'Reintentar', onClick: () => refreshChildren() }]"
      />
      <UEmpty
        v-else-if="!children?.length"
        title="Aún no hay niños vinculados"
        description="Consulte con la clínica para verificar el vínculo familiar."
      />
      <div
        v-else
        class="grid gap-4 sm:grid-cols-2"
      >
        <UCard
          v-for="child in children"
          :key="child.id"
        >
          <h2 class="text-lg font-semibold">
            {{ child.name }}
          </h2>
          <p class="text-sm text-muted">
            {{ age(child.birthDate) }}
          </p>
          <template v-if="child.lastControl">
            <p class="mt-3 font-medium">
              Último control · {{ dateFormat.format(new Date(child.lastControl.measuredAt)) }}
            </p>
            <div class="mt-2 grid grid-cols-3 gap-2 text-sm tabular-nums">
              <p>Peso<br><strong>{{ weightFormat.format(child.lastControl.weightKg) }} kg</strong></p>
              <p>{{ child.lastControl.position === 'RECUMBENT' ? 'Longitud' : 'Talla' }}<br><strong>{{ sizeFormat.format(child.lastControl.lengthHeightCm) }} cm</strong></p>
              <p>Cabeza<br><strong>{{ sizeFormat.format(child.lastControl.headCircumferenceCm) }} cm</strong></p>
            </div>
            <div
              v-if="child.lastControl.parentAdvice"
              class="mt-3 rounded-md bg-elevated p-3"
            >
              <p class="font-medium">
                Indicaciones de tu pediatra
              </p>
              <p class="whitespace-pre-wrap text-sm">
                {{ child.lastControl.parentAdvice }}
              </p>
            </div>
            <p
              v-if="child.lastControl.nextControlAt"
              class="mt-3 text-sm"
            >
              Próximo control · {{ dateTimeFormat.format(new Date(child.lastControl.nextControlAt)) }}
            </p>
          </template>
          <p
            v-else
            class="mt-3 text-sm text-muted"
          >
            Aún no hay controles compartidos.
          </p>
          <UButton
            :to="`/hijos/${child.id}`"
            variant="outline"
            class="mt-3 min-h-11"
          >
            Ver todas
          </UButton>
        </UCard>
      </div>
    </template>
    <UPageHero
      v-else
      title="Control Pediátrico"
      description="Registro de medidas y curvas de crecimiento según los Patrones de Crecimiento Infantil de la OMS."
    />
  </UContainer>
</template>
