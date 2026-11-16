<script setup lang="ts">
import type { PendingVaccine } from '#shared/types/preventive'

function whatsapp(phone: string) {
  return `https://wa.me/593${phone.slice(1)}`
}
function call(phone: string) {
  return `tel:+593${phone.slice(1)}`
}
const { data: review, error, refresh } = await useFetch<{ id: string, name: string, pending: PendingVaccine[], contacts: { name: string, phone: string }[] }[]>('/api/clinical/vacunacion-por-revisar')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ statusCode: error.value.statusCode, statusMessage: 'Acceso denegado' })
</script>

<template>
  <UContainer class="max-w-5xl space-y-5 py-6 pb-24">
    <UButton
      to="/"
      variant="link"
      icon="i-lucide-arrow-left"
    >
      Inicio
    </UButton>
    <h1 class="text-2xl font-semibold">
      Vacunación por revisar
    </h1>
    <p class="text-sm text-muted">
      Solo revisión médica: fuentes en borrador, sin indicación definitiva de aplicación, recuperación o fecha de vencimiento.
    </p>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudo cargar la revisión"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <UEmpty
      v-else-if="!review?.length"
      title="No hay pacientes con vacunas por revisar"
    />
    <UCard
      v-for="person in review"
      :key="person.id"
      class="space-y-3"
    >
      <h2 class="font-semibold">
        <NuxtLink
          :to="`/pacientes/${person.id}`"
          class="text-primary underline"
        >{{ person.name }}</NuxtLink> · {{ person.pending.length }}
      </h2>
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
    </UCard>
  </UContainer>
</template>
