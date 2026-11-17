<script setup lang="ts">
import type { PendingVaccine } from '#shared/types/preventive'

function whatsapp(phone: string) {
  return `https://wa.me/593${phone.slice(1)}`
}
function call(phone: string) {
  return `tel:+593${phone.slice(1)}`
}
const { data: review, status, error, refresh } = await useFetch<{ id: string, name: string, pending: PendingVaccine[], contacts: { name: string, phone: string }[] }[]>('/api/clinical/vacunacion-por-revisar')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ statusCode: error.value.statusCode, statusMessage: 'Acceso denegado' })
</script>

<template>
  <UContainer class="max-w-5xl space-y-4 px-4 py-4 pb-24 sm:px-6 sm:py-6">
    <div class="flex items-center gap-2">
      <UButton
        to="/"
        variant="ghost"
        color="neutral"
        icon="i-lucide-arrow-left"
        aria-label="Volver a inicio"
        class="min-h-11 min-w-11 shrink-0"
      />
      <h1 class="text-lg font-semibold sm:text-2xl">
        Vacunación por revisar
      </h1>
    </div>
    <p class="text-sm text-muted">
      Solo revisión médica: fuentes en borrador, sin indicación definitiva de aplicación, recuperación o fecha de vencimiento.
    </p>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo cargar la revisión"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else-if="status === 'pending'"
      class="space-y-2"
      aria-label="Cargando vacunas por revisar"
    >
      <USkeleton
        v-for="n in 3"
        :key="n"
        class="h-20 w-full"
      />
    </div>
    <UEmpty
      v-else-if="!review?.length"
      icon="i-lucide-syringe"
      title="No hay pacientes con vacunas por revisar"
    />
    <template v-else>
      <p class="text-xs font-semibold uppercase tracking-wide text-muted">
        Pacientes · {{ review?.length }}
      </p>
      <UCard
        v-for="person in review"
        :key="person.id"
        :ui="{ body: 'p-0 sm:p-0' }"
      >
        <NuxtLink
          :to="`/pacientes/${person.id}`"
          class="flex min-h-16 items-center gap-3 px-3 py-2 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:px-4"
        >
          <UAvatar
            :text="person.name.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase()"
            size="md"
            class="shrink-0"
          />
          <span class="min-w-0 flex-1"><span class="block font-semibold leading-snug">{{ person.name }}</span><span class="block text-xs text-muted">{{ person.pending.length }} {{ person.pending.length === 1 ? 'vacuna por revisar' : 'vacunas por revisar' }}</span></span>
          <UIcon
            name="i-lucide-chevron-right"
            class="size-4 shrink-0 text-muted"
            aria-hidden="true"
          />
        </NuxtLink>
        <div class="space-y-3 border-t border-default px-3 py-3 sm:px-4">
          <ul class="divide-y divide-default">
            <li
              v-for="item in person.pending"
              :key="item.id"
              class="py-2 text-sm"
            >
              <strong>{{ item.kind === 'MSP' ? 'MSP' : 'Complementaria' }} · {{ item.label }} · {{ item.doseLabel }}</strong><br>
              <UBadge
                color="neutral"
                variant="soft"
              >
                {{ item.badge }}
              </UBadge>
              <span class="block text-muted">{{ item.source }} · versión {{ item.version }} · {{ item.sourcePage }}<span v-if="item.recommendedAge"> · Edad documentada: {{ item.recommendedAge }}</span><span v-if="item.minimumInterval"> · Intervalo documentado: {{ item.minimumInterval }}</span></span>
            </li>
          </ul>
          <div v-if="person.contacts.length">
            <p class="font-medium">
              Contacto registrado por personal clínico
            </p>
            <p class="text-sm text-muted">
              Confirme el número y el canal con la familia antes de contactar.
            </p>
            <div
              v-for="contact in person.contacts"
              :key="contact.phone"
              class="flex flex-wrap items-center gap-2 py-2 text-sm"
            >
              {{ contact.name }} · {{ contact.phone }}
              <UButton
                :to="whatsapp(contact.phone)"
                target="_blank"
                rel="noopener noreferrer"
                variant="outline"
                class="min-h-11"
              >
                Abrir WhatsApp (si usa este número)
              </UButton>
              <UButton
                :to="call(contact.phone)"
                variant="outline"
                class="min-h-11"
              >
                Llamar
              </UButton>
            </div>
          </div>
          <p
            v-else
            class="text-sm text-muted"
          >
            Sin contacto registrado.
          </p>
        </div>
      </UCard>
    </template>
  </UContainer>
</template>
