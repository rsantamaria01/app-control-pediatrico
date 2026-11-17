<script setup lang="ts">
import { z } from 'zod'
import type { FormErrorEvent, FormSubmitEvent } from '@nuxt/ui'
import type { ClinicSettings, ClinicSettingsInput } from '#shared/types/admin'

withDefaults(defineProps<{ section?: 'clinic' | 'brand' | 'contact' | 'all' }>(), { section: 'all' })
const emit = defineEmits<{ saved: [] }>()
const { data, error, status, refresh } = await useFetch<ClinicSettings | null>('/api/admin/clinica')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ status: error.value.statusCode, statusText: 'Acceso denegado' })
const state = reactive<ClinicSettingsInput>({ name: '', contactEmail: '', primary: 'brand', logo: null })
watch(data, (value) => {
  if (value) Object.assign(state, { name: value.name, contactEmail: value.contactEmail, primary: value.primary, logo: value.logo })
}, { immediate: true })
const schema = z.object({
  name: z.string().trim().min(2, 'Ingrese el nombre de la clínica').max(160),
  contactEmail: z.email('Ingrese un correo válido').max(254),
  primary: z.enum(['brand', 'teal', 'indigo', 'violet', 'rose', 'emerald']),
  logo: z.union([z.literal(null), z.string().regex(/^\/branding\/[a-z0-9_-]+\.(png|webp|svg)$/, 'Use una ruta de /branding/')])
})
const palettes = [
  { label: 'Marca', value: 'brand' }, { label: 'Verde azulado', value: 'teal' },
  { label: 'Índigo', value: 'indigo' }, { label: 'Violeta', value: 'violet' },
  { label: 'Rosa', value: 'rose' }, { label: 'Esmeralda', value: 'emerald' }
]
const logoPath = computed({
  get: () => state.logo ?? '',
  set: (value) => { state.logo = value || null }
})
const saving = ref(false)
const feedback = ref<'saved' | 'error' | null>(null)
async function save(event: FormSubmitEvent<ClinicSettingsInput>) {
  if (saving.value) return
  saving.value = true
  feedback.value = null
  try {
    data.value = await $fetch<ClinicSettings>('/api/admin/clinica', { method: 'PUT', body: event.data })
    feedback.value = 'saved'
    await refreshNuxtData('clinic-brand')
    emit('saved')
  } catch {
    feedback.value = 'error'
  } finally {
    saving.value = false
  }
}
function focusError(event: FormErrorEvent) {
  if (import.meta.client && event.errors[0]?.id) document.getElementById(event.errors[0].id)?.focus()
}
</script>

<template>
  <UAlert
    v-if="error"
    color="error"
    variant="soft"
    title="No se pudo cargar la clínica"
    :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
  />
  <USkeleton
    v-else-if="status === 'pending'"
    class="h-56 w-full"
  />
  <UForm
    v-else
    :schema="schema"
    :state="state"
    :validate-on="['blur', 'change']"
    class="space-y-5"
    @submit="save"
    @error="focusError"
  >
    <div
      v-if="section === 'all' || section === 'clinic'"
      class="space-y-3"
    >
      <h2 class="text-lg font-semibold">
        Clínica
      </h2>
      <UFormField
        name="name"
        label="Nombre de la clínica"
        required
      >
        <UInput
          v-model="state.name"
          autocomplete="organization"
          class="w-full"
          size="xl"
        />
      </UFormField>
    </div>
    <div
      v-if="section === 'all' || section === 'brand'"
      class="space-y-3"
    >
      <h2 class="text-lg font-semibold">
        Marca
      </h2>
      <p class="text-sm text-muted">
        Solo cambian el logo y el color primario. Los colores clínicos y las curvas permanecen fijos.
      </p>
      <UFormField
        name="primary"
        label="Color primario"
        required
      >
        <USelect
          v-model="state.primary"
          :items="palettes"
          class="w-full"
          size="xl"
        />
      </UFormField>
      <UFormField
        name="logo"
        label="Ruta del logo"
        description="Opcional. El archivo debe estar alojado en /branding/; la carga de archivos no está disponible en esta pantalla."
      >
        <UInput
          v-model="logoPath"
          class="w-full"
          size="xl"
          autocomplete="off"
          placeholder="/branding/logo.svg"
        />
      </UFormField>
    </div>
    <div
      v-if="section === 'all' || section === 'contact'"
      class="space-y-3"
    >
      <h2 class="text-lg font-semibold">
        Contacto
      </h2>
      <UFormField
        name="contactEmail"
        label="Correo de contacto"
        required
      >
        <UInput
          v-model="state.contactEmail"
          type="email"
          autocomplete="email"
          class="w-full"
          size="xl"
        />
      </UFormField>
    </div>
    <UAlert
      v-if="feedback === 'saved'"
      color="success"
      variant="soft"
      title="Configuración guardada"
      role="status"
    />
    <UAlert
      v-else-if="feedback === 'error'"
      color="error"
      variant="soft"
      title="No se pudo guardar la configuración"
      role="alert"
    />
    <UButton
      type="submit"
      :loading="saving"
      :disabled="saving"
      class="min-h-11"
    >
      Guardar clínica
    </UButton>
  </UForm>
</template>
