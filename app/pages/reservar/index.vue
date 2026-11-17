<script setup lang="ts">
import type { Slot } from '#shared/types/scheduling'

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const form = reactive({ date: today, time: '', childName: '', birthDate: '', sex: '', guardianName: '', relationship: '', email: '', phone: '', consent: false, code: '' })
const step = ref(0)
const token = ref('')
const message = ref('')
const busy = ref(false)
const { data: slots, error: slotsError, refresh: refreshSlots } = await useFetch<Slot[]>('/api/reservar/horarios', { query: computed(() => ({ from: form.date, to: form.date })), default: () => [] })
const dateFormat = new Intl.DateTimeFormat('es-EC', { dateStyle: 'long', timeZone: 'UTC' })
const monthFormat = new Intl.DateTimeFormat('es-EC', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const weekdayFormat = new Intl.DateTimeFormat('es-EC', { weekday: 'short', timeZone: 'UTC' })
const days = computed(() => Array.from({ length: 5 }, (_, index) => {
  const date = new Date(`${today}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + index)
  return { value: date.toISOString().slice(0, 10), weekday: weekdayFormat.format(date), number: date.getUTCDate() }
}))
watch(() => form.date, () => {
  form.time = ''
})
async function sendCode() {
  message.value = ''
  busy.value = true
  try {
    await $fetch('/api/reservar/codigo', { method: 'POST', body: { email: form.email } })
    step.value = 3
    message.value = 'Si el correo está disponible, recibirá un código de verificación.'
  } catch {
    message.value = 'No fue posible iniciar la verificación. Inténtelo más tarde o comuníquese con la clínica.'
  } finally {
    busy.value = false
  }
}
async function verify() {
  message.value = ''
  busy.value = true
  try {
    const result = await $fetch<{ verificationToken: string }>('/api/reservar/verificar', { method: 'POST', body: { email: form.email, code: form.code } })
    token.value = result.verificationToken
    message.value = 'Correo verificado. Ya puede enviar la solicitud.'
  } catch {
    message.value = 'Código inválido o vencido. Solicite uno nuevo.'
  } finally {
    busy.value = false
  }
}
async function submit() {
  message.value = ''
  busy.value = true
  try {
    await $fetch('/api/reservar', { method: 'POST', body: { date: form.date, time: form.time, childName: form.childName, birthDate: form.birthDate, sex: form.sex, guardianName: form.guardianName, relationship: form.relationship, email: form.email, phone: form.phone, consent: form.consent, consentVersion: 'DRAFT-2026-11', verificationToken: token.value } })
    token.value = ''
    step.value = 4
  } catch {
    message.value = 'No se pudo enviar la solicitud. Revise los datos y el horario disponible.'
    await refreshSlots()
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-lg px-0 pb-12 sm:px-4 sm:py-8">
    <div
      v-if="step < 4"
      class="sticky top-0 z-10 border-b border-default bg-default px-4 py-3 sm:rounded-t-xl sm:border-x sm:border-t"
    >
      <div class="flex items-center justify-between gap-2 text-sm">
        <h1 class="font-semibold">
          {{ ['Fecha y horario', 'Datos', 'Consentimiento', 'Verificar email'][step] }}
        </h1>
        <span
          class="text-muted"
          aria-live="polite"
        >Paso {{ step + 1 }} de 4</span>
      </div>
      <progress
        :value="step + 1"
        max="4"
        aria-label="Progreso de la reserva"
        class="mt-2 h-1 w-full overflow-hidden rounded-full accent-primary"
      />
    </div>
    <p
      v-if="message"
      role="status"
      class="mx-4 mt-4 rounded-lg border border-default bg-default p-3 text-sm"
    >
      {{ message }}
    </p>
    <section
      v-if="step === 0"
      class="min-h-[calc(100dvh-7rem)] bg-muted px-4 py-4 sm:rounded-b-xl sm:border sm:border-t-0 sm:border-default"
    >
      <form
        class="flex min-h-[calc(100dvh-9rem)] flex-col gap-4"
        @submit.prevent="step = 1"
      >
        <h2 class="text-sm font-medium capitalize text-muted">
          {{ monthFormat.format(new Date(`${form.date}T12:00:00Z`)) }}
        </h2>
        <div
          class="flex gap-2 overflow-x-auto pb-1"
          aria-label="Próximos días"
        >
          <button
            v-for="day in days"
            :key="day.value"
            type="button"
            :aria-pressed="form.date === day.value"
            class="flex min-h-16 min-w-14 flex-col items-center justify-center rounded-lg border border-default bg-default text-sm font-semibold focus-visible:outline-2 focus-visible:outline-primary"
            :class="form.date === day.value ? 'border-primary bg-primary text-inverted' : ''"
            @click="form.date = day.value"
          >
            <span class="text-xs capitalize">{{ day.weekday }}</span>{{ day.number }}
          </button>
        </div>
        <label
          for="public-date"
          class="block text-sm font-medium text-muted"
        >Fecha seleccionada · primera consulta</label>
        <input
          id="public-date"
          v-model="form.date"
          name="date"
          type="date"
          :min="today"
          required
          class="min-h-12 w-full rounded-lg border border-default bg-default px-3 text-base focus-visible:outline-2 focus-visible:outline-primary"
        >
        <UAlert
          v-if="slotsError"
          color="error"
          title="No se pudieron consultar los horarios"
          :actions="[{ label: 'Reintentar', onClick: () => refreshSlots() }]"
        />
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium text-muted">
            {{ dateFormat.format(new Date(`${form.date}T12:00:00Z`)) }} · horarios libres
          </legend><div class="grid grid-cols-3 gap-2">
            <label
              v-for="slot in slots"
              :key="slot.time"
              class="flex min-h-11 items-center justify-center rounded-lg border border-default bg-default px-2 text-sm font-semibold focus-within:outline-2 focus-within:outline-primary has-checked:border-primary has-checked:bg-primary has-checked:text-inverted"
            ><input
              v-model="form.time"
              type="radio"
              name="public-time"
              :value="slot.time"
              required
              class="sr-only"
            >{{ slot.time }}</label>
          </div><p
            v-if="!slots?.length && !slotsError"
            class="text-sm text-muted"
          >
            No hay horarios libres este día.
          </p>
        </fieldset>
        <p class="text-xs text-muted">
          Solo se muestran horarios libres según la disponibilidad de la clínica.
        </p>
        <div class="mt-auto border-t border-default bg-default px-1 py-3">
          <UButton
            type="submit"
            :disabled="!form.time"
            class="min-h-12 w-full justify-center"
          >
            Continuar
          </UButton>
        </div>
      </form>
    </section>
    <UCard
      v-else-if="step === 1"
      class="mx-4 mt-4 sm:mx-0"
      :ui="{ body: 'p-4 sm:p-5' }"
    >
      <h2 class="mb-4 text-sm font-bold">
        Niño/a
      </h2>
      <form
        class="space-y-4"
        @submit.prevent="step = 2"
      >
        <UFormField label="Nombres y apellidos del niño/a">
          <UInput
            v-model="form.childName"
            required
            minlength="2"
            maxlength="160"
            class="w-full"
          />
        </UFormField>
        <label
          for="public-birth"
          class="block text-sm font-medium"
        >Fecha de nacimiento</label>
        <input
          id="public-birth"
          v-model="form.birthDate"
          type="date"
          :max="today"
          required
          class="min-h-11 w-full rounded-md border border-default bg-default px-3 focus-visible:outline-2 focus-visible:outline-primary"
        >
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">
            Sexo registrado al nacer
          </legend><div class="flex gap-2">
            <label class="flex min-h-12 flex-1 items-center gap-2 rounded-lg border border-default px-3 focus-within:outline-2 focus-within:outline-primary has-checked:border-primary has-checked:bg-primary/10"><input
              v-model="form.sex"
              type="radio"
              name="sex"
              value="MALE"
              required
            > Masculino</label><label class="flex min-h-12 flex-1 items-center gap-2 rounded-lg border border-default px-3 focus-within:outline-2 focus-within:outline-primary has-checked:border-primary has-checked:bg-primary/10"><input
              v-model="form.sex"
              type="radio"
              name="sex"
              value="FEMALE"
              required
            > Femenino</label>
          </div>
        </fieldset>
        <h3 class="pt-2 text-sm font-bold">
          Representante
        </h3>
        <UFormField label="Nombre del representante">
          <UInput
            v-model="form.guardianName"
            required
            minlength="2"
            maxlength="160"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Parentesco">
          <UInput
            v-model="form.relationship"
            required
            minlength="2"
            maxlength="80"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Correo electrónico">
          <UInput
            v-model="form.email"
            type="email"
            required
            class="w-full"
          />
        </UFormField>
        <UFormField label="Teléfono / WhatsApp">
          <UInput
            v-model="form.phone"
            type="tel"
            required
            pattern="(09[0-9]{8}|\+5939[0-9]{8})"
            class="w-full"
          />
        </UFormField>
        <div class="flex gap-2">
          <UButton
            variant="outline"
            class="min-h-11"
            @click="step = 0"
          >
            Volver
          </UButton><UButton
            type="submit"
            class="min-h-11 flex-1 justify-center"
          >
            Continuar
          </UButton>
        </div>
      </form>
    </UCard>
    <UCard
      v-else-if="step === 2"
      class="mx-4 mt-4 sm:mx-0"
      :ui="{ body: 'p-4 sm:p-5' }"
    >
      <h2 class="mb-4 text-lg font-semibold">
        Consentimiento
      </h2>
      <p class="mb-4 text-sm">
        Para solicitar la cita se tratarán los datos de contacto y los datos identificativos del niño/a. Texto de privacidad y consentimiento en borrador, pendiente de revisión legal.
      </p>
      <label class="flex min-h-11 items-start gap-3 text-sm"><input
        v-model="form.consent"
        type="checkbox"
        class="mt-1 size-5"
      >Autorizo el tratamiento de estos datos para gestionar la solicitud de cita.</label>
      <div class="mt-4 flex gap-2">
        <UButton
          variant="outline"
          class="min-h-11"
          @click="step = 1"
        >
          Volver
        </UButton><UButton
          :disabled="!form.consent || busy"
          :loading="busy"
          class="min-h-11 flex-1 justify-center"
          @click="sendCode"
        >
          Verificar correo
        </UButton>
      </div>
    </UCard>
    <UCard
      v-else-if="step === 3"
      class="mx-4 mt-4 sm:mx-0"
      :ui="{ body: 'p-4 sm:p-5' }"
    >
      <p class="mb-5 rounded-lg border border-default bg-default p-3 text-sm">
        Autorizó el tratamiento de los datos para gestionar esta solicitud. <NuxtLink
          to="/privacidad"
          class="font-semibold text-primary underline"
        >Ver privacidad</NuxtLink>
      </p>
      <h2 class="text-xl font-bold">
        Ingrese el código
      </h2>
      <p class="mb-5 mt-1 text-sm text-muted">
        Lo enviamos a <strong class="text-default">{{ form.email }}</strong> para confirmar que el correo es suyo. Puede pegarlo completo; verificar el correo no concede acceso al portal.
      </p>
      <form
        v-if="!token"
        class="space-y-4"
        @submit.prevent="verify"
      >
        <UFormField label="Código de 6 dígitos">
          <UInput
            v-model="form.code"
            name="code"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            maxlength="6"
            required
            class="w-full"
          />
        </UFormField><UButton
          type="submit"
          :loading="busy"
          class="min-h-11 w-full justify-center"
        >
          Verificar
        </UButton>
      </form>
      <div class="mt-4 rounded-lg bg-elevated p-3 text-sm">
        <p class="font-semibold">
          Resumen
        </p>
        <p class="text-muted">
          {{ form.childName }} · {{ dateFormat.format(new Date(`${form.date}T12:00:00Z`)) }} · {{ form.time }} · Primera consulta
        </p>
      </div>
      <UButton
        v-if="token"
        :loading="busy"
        class="mt-4 min-h-11 w-full justify-center"
        @click="submit"
      >
        Enviar solicitud
      </UButton>
      <UButton
        v-else
        variant="link"
        class="mt-4 min-h-11"
        :disabled="busy"
        @click="sendCode"
      >
        Solicitar otro código
      </UButton>
    </UCard>
    <section
      v-else
      class="flex min-h-dvh flex-col items-center justify-center gap-4 bg-default px-6 py-12 text-center"
    >
      <span class="flex size-[72px] items-center justify-center rounded-full bg-success/15 text-success"><UIcon
        name="i-lucide-send"
        class="size-9"
        aria-hidden="true"
      /></span>
      <h1 class="text-2xl font-bold">
        Solicitud enviada
      </h1><p class="text-muted">
        La clínica revisará su solicitud para el <strong class="text-default">{{ dateFormat.format(new Date(`${form.date}T12:00:00Z`)) }} a las {{ form.time }}</strong>.
      </p><p class="flex gap-2 rounded-lg bg-warning/15 p-3 text-left text-sm text-warning">
        <UIcon
          name="i-lucide-clock"
          class="mt-0.5 size-5 shrink-0"
          aria-hidden="true"
        />Aún no está confirmada. Comuníquese con la clínica para consultar el estado; esta solicitud no crea acceso al portal.
      </p><UButton
        to="/"
        variant="outline"
        color="neutral"
        class="mt-3 min-h-12 w-full justify-center"
      >
        Volver a la página de la clínica
      </UButton>
    </section>
  </UContainer>
</template>
