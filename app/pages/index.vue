<script setup lang="ts">
import type { Appointment } from '#shared/types/scheduling'
import type { FamilyChildSummary } from '../../server/services/invitations'

const route = useRoute()
const { user } = useUserSession()
const { data: navigation } = await useFetch<{ label: string, to: string }[]>('/api/auth/navigation')
const isAdmin = computed(() => Boolean(navigation.value?.some(item => item.to === '/admin/clinica')))
const hasDoctorRole = computed(() => Boolean(navigation.value?.some(item => item.to === '/pacientes')))
const hasStaffRole = computed(() => hasDoctorRole.value || Boolean(navigation.value?.some(item => item.to === '/agenda' || item.to.startsWith('/admin/'))))
const isFamilyView = computed(() => route.query.vista === 'familiar' && Boolean(navigation.value?.some(item => item.to === '/citas')))
const isDoctor = computed(() => hasDoctorRole.value && !isFamilyView.value)
const isParent = computed(() => Boolean(navigation.value?.some(item => item.to === '/citas')) && (!hasStaffRole.value || isFamilyView.value))
if (!user.value) {
  await navigateTo('/acceso')
} else if (!isDoctor.value && !isParent.value) {
  await navigateTo(navigation.value?.some(item => item.to === '/agenda') ? '/agenda' : isAdmin.value ? '/admin/inicio' : '/acceso')
}
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const { data: appointments, error, refresh } = await useFetch<Appointment[]>('/api/agenda', { query: { from: today, to: today }, immediate: isDoctor.value, default: () => [] })
const { data: requestsCount, error: requestsError, refresh: refreshRequests } = await useFetch<{ count: number }>('/api/agenda/solicitudes/count', { immediate: isDoctor.value })
const { data: growthReview, error: growthError, refresh: refreshGrowth } = await useFetch<{ id: string }[]>('/api/clinical/crecimiento-por-revisar', { immediate: isDoctor.value, default: () => [] })
const { data: vaccineReview, error: vaccineError, refresh: refreshVaccines } = await useFetch<{ id: string }[]>('/api/clinical/vacunacion-por-revisar', { immediate: isDoctor.value, default: () => [] })
const { data: controlsReview, error: controlsError, refresh: refreshControls } = await useFetch<{ id: string }[]>('/api/clinical/controles-pendientes', { immediate: isDoctor.value, default: () => [] })
const active = computed(() => appointments.value?.filter(item => item.status !== 'CANCELLED') ?? [])
const formattedToday = new Intl.DateTimeFormat('es-EC', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Guayaquil' }).format(new Date(`${today}T12:00:00-05:00`))
const todayLabel = formattedToday.charAt(0).toUpperCase() + formattedToday.slice(1)
const upcoming = computed(() => active.value.filter(item => item.status !== 'ATTENDED' && new Date(`${item.date}T${item.time}:00-05:00`) >= new Date()))
const appointmentStatus = (status: string) => status === 'ATTENDED' ? 'Atendida' : status === 'PENDING' ? 'Por confirmar' : status === 'CONFIRMED' ? 'Confirmada' : 'Programada'
const greeting = new Intl.DateTimeFormat('es-EC', { hour: 'numeric', hourCycle: 'h23', timeZone: 'America/Guayaquil' }).format(new Date())
const greetingLabel = Number(greeting) < 12 ? 'Buenos días' : Number(greeting) < 19 ? 'Buenas tardes' : 'Buenas noches'
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
            {{ todayLabel }}
          </p>
          <h1 class="text-2xl font-semibold tracking-tight">
            {{ greetingLabel }}{{ user?.name ? `, ${user.name}` : '' }}
          </h1>
        </div>
        <UButton
          to="/pacientes/nuevo"
          icon="i-lucide-plus"
          size="lg"
          class="min-h-11 lg:hidden"
        >
          Nuevo paciente
        </UButton>
      </div>
      <div class="space-y-4">
        <UCard>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h2 class="text-lg font-semibold">
              Hoy
            </h2>
            <UButton
              to="/agenda?vista=dia"
              variant="link"
              trailing-icon="i-lucide-chevron-right"
              class="min-h-11"
            >
              Ver agenda completa
            </UButton>
          </div>
          <UAlert
            v-if="error"
            color="error"
            variant="soft"
            title="No se pudo cargar la agenda"
            :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
            class="mt-3"
          />
          <template v-else>
            <dl class="mt-3 grid grid-cols-3 divide-x divide-default rounded-lg border border-default py-3 text-center tabular-nums">
              <div class="px-1">
                <dt class="text-xs text-muted sm:text-sm">
                  Citas
                </dt>
                <dd class="text-xl font-semibold">
                  {{ active.length }}
                </dd>
              </div>
              <div class="px-1">
                <dt class="text-xs text-muted sm:text-sm">
                  Por confirmar
                </dt>
                <dd class="text-xl font-semibold">
                  {{ active.filter(item => item.status === 'PENDING').length }}
                </dd>
              </div>
              <div class="px-1">
                <dt class="text-xs text-muted sm:text-sm">
                  Atendidas
                </dt>
                <dd class="text-xl font-semibold">
                  {{ active.filter(item => item.status === 'ATTENDED').length }}
                </dd>
              </div>
            </dl>
            <div class="mt-4 flex items-center justify-between gap-2">
              <h3 class="text-sm font-semibold">
                Próximas citas
              </h3>
              <span class="text-xs text-muted tabular-nums">{{ upcoming.length }}</span>
            </div>
            <p
              v-if="!upcoming.length"
              class="mt-2 text-sm text-muted"
            >
              Sin próximas citas hoy.
            </p>
            <ul
              v-else
              class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3"
            >
              <li
                v-for="item in upcoming"
                :key="item.id"
                class="flex flex-col gap-1 rounded-lg border border-default bg-elevated p-3 text-sm"
              >
                <strong class="text-base tabular-nums">{{ item.time }}</strong>
                <div class="min-w-0 flex-1">
                  <NuxtLink
                    v-if="item.patientId"
                    :to="`/pacientes/${item.patientId}`"
                    class="inline-flex min-h-11 items-center font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >{{ item.name }}</NuxtLink>
                  <span
                    v-else
                    class="block py-2 font-semibold"
                  >{{ item.name }}</span>
                  <p class="text-xs text-muted">
                    {{ item.birthDate ? age(item.birthDate) : 'Edad no registrada' }} · {{ item.lastWeightKg !== undefined ? `${weightFormat.format(item.lastWeightKg)} kg` : 'Peso no registrado' }}<template v-if="item.reason">
                      · {{ item.reason }}
                    </template>
                  </p>
                </div>
                <UBadge
                  color="neutral"
                  variant="soft"
                  size="sm"
                  class="self-start"
                >
                  {{ appointmentStatus(item.status) }}
                </UBadge>
              </li>
            </ul>
          </template>
        </UCard>
        <UCard :ui="{ body: 'p-0 sm:p-0' }">
          <div class="flex flex-wrap items-center gap-3 p-4">
            <UIcon
              name="i-lucide-inbox"
              class="size-5 shrink-0 text-primary"
              aria-hidden="true"
            />
            <NuxtLink
              to="/agenda/solicitudes"
              class="flex min-h-11 min-w-0 flex-1 items-center gap-2 font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span class="min-w-0 flex-1">Solicitudes de reserva pendientes</span>
              <UBadge
                v-if="!requestsError"
                color="primary"
                variant="soft"
                class="tabular-nums"
              >
                {{ requestsCount?.count ?? 0 }}
              </UBadge>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0"
                aria-hidden="true"
              />
            </NuxtLink>
            <UButton
              v-if="requestsError"
              variant="link"
              class="min-h-11"
              @click="refreshRequests()"
            >
              Reintentar
            </UButton>
          </div>
        </UCard>
      </div>
      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <h2 class="p-4 text-lg font-semibold">
          Mis pacientes
        </h2>
        <ul class="divide-y divide-default border-t border-default">
          <li class="flex min-h-14 items-center gap-2 px-4">
            <NuxtLink
              to="/pacientes/vacunacion-por-revisar"
              class="flex min-h-14 min-w-0 flex-1 items-center gap-3 font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <UIcon
                name="i-lucide-syringe"
                class="size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">Vacunación por revisar</span>
              <UBadge
                v-if="!vaccineError"
                color="neutral"
                variant="soft"
                class="tabular-nums"
              >
                {{ vaccineReview?.length ?? 0 }}
              </UBadge>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0 text-muted"
                aria-hidden="true"
              />
            </NuxtLink>
            <UButton
              v-if="vaccineError"
              variant="link"
              class="min-h-11"
              @click="refreshVaccines()"
            >
              Reintentar
            </UButton>
          </li>
          <li class="flex min-h-14 items-center gap-2 px-4">
            <NuxtLink
              to="/pacientes/crecimiento-por-revisar"
              class="flex min-h-14 min-w-0 flex-1 items-center gap-3 font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <UIcon
                name="i-lucide-chart-no-axes-combined"
                class="size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">Crecimiento por revisar</span>
              <UBadge
                v-if="!growthError"
                color="neutral"
                variant="soft"
                class="tabular-nums"
              >
                {{ growthReview?.length ?? 0 }}
              </UBadge>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0 text-muted"
                aria-hidden="true"
              />
            </NuxtLink>
            <UButton
              v-if="growthError"
              variant="link"
              class="min-h-11"
              @click="refreshGrowth()"
            >
              Reintentar
            </UButton>
          </li>
          <li class="flex min-h-14 items-center gap-2 px-4">
            <NuxtLink
              to="/pacientes/controles-pendientes"
              class="flex min-h-14 min-w-0 flex-1 items-center gap-3 font-medium hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <UIcon
                name="i-lucide-calendar-clock"
                class="size-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">Controles pendientes</span>
              <UBadge
                v-if="!controlsError"
                color="neutral"
                variant="soft"
                class="tabular-nums"
              >
                {{ controlsReview?.length ?? 0 }}
              </UBadge>
              <UIcon
                name="i-lucide-chevron-right"
                class="size-4 shrink-0 text-muted"
                aria-hidden="true"
              />
            </NuxtLink>
            <UButton
              v-if="controlsError"
              variant="link"
              class="min-h-11"
              @click="refreshControls()"
            >
              Reintentar
            </UButton>
          </li>
        </ul>
      </UCard>
    </template>
    <template v-else-if="isParent">
      <h1 class="text-2xl font-semibold">
        Hola{{ user?.name ? `, ${user.name.split(' ')[0]}` : '' }}
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
        <NuxtLink
          v-for="child in children"
          :key="child.id"
          :to="`/hijos/${child.id}`"
          class="block rounded-xl border border-default bg-default p-4 transition hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
        >
          <span class="flex items-center gap-3">
            <UAvatar :text="child.name.slice(0, 1).toUpperCase()" size="lg" />
            <span class="min-w-0 flex-1"><span class="block text-lg font-semibold">{{ child.name }}</span><span class="text-sm text-muted">{{ age(child.birthDate) }}</span></span>
            <UIcon name="i-lucide-chevron-right" class="size-5 text-muted" aria-hidden="true" />
          </span>
          <template v-if="child.lastControl">
            <span class="mt-3 block font-medium">Último control · {{ dateFormat.format(new Date(child.lastControl.measuredAt)) }}</span>
            <span class="mt-2 grid grid-cols-3 gap-2 text-sm tabular-nums"><span>Peso<br><strong>{{ weightFormat.format(child.lastControl.weightKg) }} kg</strong></span><span>{{ child.lastControl.position === 'RECUMBENT' ? 'Longitud' : 'Talla' }}<br><strong>{{ sizeFormat.format(child.lastControl.lengthHeightCm) }} cm</strong></span><span>Cabeza<br><strong>{{ sizeFormat.format(child.lastControl.headCircumferenceCm) }} cm</strong></span></span>
            <span v-if="child.lastControl.parentAdvice" class="mt-3 block rounded-lg bg-primary/10 p-3"><span class="block font-medium text-primary">Indicaciones de tu pediatra</span><span class="line-clamp-2 text-sm">{{ child.lastControl.parentAdvice }}</span></span>
            <span v-if="child.lastControl.nextControlAt" class="mt-3 block text-sm">Próximo control · {{ dateTimeFormat.format(new Date(child.lastControl.nextControlAt)) }}</span>
          </template>
          <span v-else class="mt-3 block text-sm text-muted">Aún no hay controles compartidos.</span>
        </NuxtLink>
      </div>
    </template>
  </UContainer>
</template>
