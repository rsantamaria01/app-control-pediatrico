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
  <UContainer class="max-w-lg space-y-5 py-6 pb-16">
    <div class="flex items-center justify-between gap-2">
      <h1 class="text-2xl font-semibold">
        Reservar primera cita
      </h1>
      <UButton
        to="/acceso"
        variant="link"
      >
        Ingresar
      </UButton>
    </div>
    <p class="text-sm text-muted">
      Solicite un horario para su hijo/a. La cita siempre queda pendiente de aprobación hasta que la clínica la revise. Reservar no crea una cuenta en el portal.
    </p>
    <p
      v-if="step < 4"
      class="text-sm font-medium"
      aria-live="polite"
    >
      Paso {{ step + 1 }} de 4
    </p>
    <p
      v-if="message"
      role="status"
      class="text-sm"
    >
      {{ message }}
    </p>
    <UCard v-if="step === 0">
      <h2 class="mb-4 text-lg font-semibold">
        Fecha y horario
      </h2>
      <form
        class="space-y-4"
        @submit.prevent="step = 1"
      >
        <label
          for="public-date"
          class="block text-sm font-medium"
        >Fecha</label>
        <input
          id="public-date"
          v-model="form.date"
          type="date"
          :min="today"
          required
          class="min-h-11 w-full rounded-md border border-default bg-default px-3 focus-visible:outline-2 focus-visible:outline-primary"
        >
        <UAlert
          v-if="slotsError"
          color="error"
          title="No se pudieron consultar los horarios"
          :actions="[{ label: 'Reintentar', onClick: () => refreshSlots() }]"
        />
        <fieldset class="space-y-2">
          <legend class="text-sm font-medium">
            Horarios libres
          </legend><div class="grid grid-cols-3 gap-2">
            <label
              v-for="slot in slots"
              :key="slot.time"
              class="flex min-h-11 items-center justify-center rounded-md border border-default px-2 focus-within:outline-2 focus-within:outline-primary has-checked:border-primary has-checked:bg-primary/10"
            ><input
              v-model="form.time"
              type="radio"
              name="public-time"
              :value="slot.time"
              required
              class="sr-only"
            >{{ slot.time }}</label>
          </div><p
            v-if="!slots?.length"
            class="text-sm text-muted"
          >
            No hay horarios libres este día.
          </p>
        </fieldset>
        <UButton
          type="submit"
          :disabled="!form.time"
          class="min-h-11 w-full justify-center"
        >
          Continuar
        </UButton>
      </form>
    </UCard>
    <UCard v-else-if="step === 1">
      <h2 class="mb-4 text-lg font-semibold">
        Datos del niño/a y representante
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
          </legend><div class="flex gap-4">
            <label class="flex min-h-11 items-center gap-2"><input
              v-model="form.sex"
              type="radio"
              name="sex"
              value="MALE"
              required
            > Masculino</label><label class="flex min-h-11 items-center gap-2"><input
              v-model="form.sex"
              type="radio"
              name="sex"
              value="FEMALE"
              required
            > Femenino</label>
          </div>
        </fieldset>
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
    <UCard v-else-if="step === 2">
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
    <UCard v-else-if="step === 3">
      <h2 class="mb-4 text-lg font-semibold">
        Verificar correo
      </h2>
      <p class="mb-4 text-sm">
        Ingrese el código enviado a {{ form.email }}. Puede pegarlo completo; verificar el correo no concede acceso al portal.
      </p>
      <form
        v-if="!token"
        class="space-y-4"
        @submit.prevent="verify"
      >
        <UFormField label="Código de 6 dígitos">
          <UInput
            v-model="form.code"
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
      <p class="mt-4 rounded-lg bg-elevated p-3 text-sm">
        {{ form.childName }} · {{ dateFormat.format(new Date(`${form.date}T12:00:00Z`)) }} · {{ form.time }}
      </p>
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
    <UCard
      v-else
      class="text-center"
    >
      <h2 class="text-2xl font-semibold">
        Solicitud enviada
      </h2><p class="mt-3">
        Su solicitud está pendiente de aprobación. La clínica revisará el horario solicitado.
      </p><p class="mt-3 text-sm text-muted">
        Esta pantalla no confirma una cita ni crea acceso al portal. Si necesita consultar el estado, comuníquese con la clínica.
      </p><UButton
        to="/"
        variant="outline"
        class="mt-5 min-h-11"
      >
        Volver al inicio
      </UButton>
    </UCard>
  </UContainer>
</template>
