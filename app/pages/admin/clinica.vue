<script setup lang="ts">
import type { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { smtpSettingsSchema, smtpTestSchema, type SmtpSettingsInput, type SmtpSettingsView } from '#shared/types/smtp'

const { data, error, status, refresh } = await useFetch<SmtpSettingsView>('/api/admin/smtp')
if (error.value?.statusCode === 401 || error.value?.statusCode === 403) {
  throw createError({ status: error.value.statusCode, statusText: 'Access denied' })
}

const settings = reactive<SmtpSettingsInput>({ host: '', port: 587, security: 'STARTTLS', username: '', password: '', fromName: '', fromAddress: '' })
watch(data, (view) => {
  if (!view) return
  Object.assign(settings, { host: view.host ?? '', port: view.port ?? 587, security: view.security ?? 'STARTTLS', username: view.username ?? '', password: '', fromName: view.fromName ?? '', fromAddress: view.fromAddress ?? '' })
}, { immediate: true })

const recipient = reactive({ email: '' })
const saving = ref(false)
const testing = ref(false)
const saveFeedback = ref<'saved' | 'error' | null>(null)
const testFeedback = ref<'sent' | 'limited' | 'unavailable' | 'failed' | null>(null)
const testError = ref<string | null>(null)
const securityOptions = [
  { label: 'Sin cifrado', value: 'NONE' },
  { label: 'STARTTLS', value: 'STARTTLS' },
  { label: 'TLS', value: 'TLS' }
]
const lastChanged = computed(() => data.value?.updatedAt ? new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.value.updatedAt)) : null)

async function save(event: FormSubmitEvent<z.output<typeof smtpSettingsSchema>>) {
  saving.value = true
  saveFeedback.value = null
  testFeedback.value = null
  try {
    data.value = await $fetch<SmtpSettingsView>('/api/admin/smtp', { method: 'PUT', body: event.data })
    settings.password = ''
    saveFeedback.value = 'saved'
  } catch {
    saveFeedback.value = 'error'
  } finally {
    saving.value = false
  }
}

async function sendTest(event: FormSubmitEvent<z.output<typeof smtpTestSchema>>) {
  testing.value = true
  testFeedback.value = null
  testError.value = null
  try {
    await $fetch('/api/admin/smtp/test', { method: 'POST', body: event.data })
    testFeedback.value = 'sent'
  } catch (cause) {
    const code = (cause as { statusCode?: number }).statusCode
    const providerMessage = (cause as { statusMessage?: string }).statusMessage
    testFeedback.value = code === 429 ? 'limited' : code === 503 ? 'unavailable' : 'failed'
    testError.value = code === 502 && /^El servidor SMTP rechazó el correo \([45]\d\d\)$/.test(providerMessage ?? '') ? providerMessage! : null
  } finally {
    testing.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-5xl space-y-6 py-6 pb-24">
    <div class="space-y-2">
      <h1 class="text-2xl font-semibold">
        Ajustes de la clínica
      </h1>
      <p class="text-sm text-muted">
        Configure el correo saliente para las comunicaciones de la clínica.
      </p>
    </div>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudo cargar la configuración de correo"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else-if="status === 'pending'"
      class="space-y-3"
      aria-label="Cargando configuración de correo"
    >
      <USkeleton class="h-32 w-full" /><USkeleton class="h-64 w-full" />
    </div>
    <div
      v-else
      class="grid gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
    >
      <section aria-labelledby="smtp-heading">
        <UCard>
          <div class="space-y-5">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2
                  id="smtp-heading"
                  class="text-lg font-semibold"
                >
                  Correo saliente
                </h2>
                <p class="text-sm text-muted">
                  El remitente aparecerá en los correos enviados desde esta clínica.
                </p>
              </div>
              <UBadge
                :color="data?.configured ? 'success' : 'neutral'"
                variant="soft"
              >
                {{ data?.configured ? 'Configurado' : 'Sin configurar' }}
              </UBadge>
            </div>
            <p class="text-sm text-muted">
              {{ data?.source === 'ADMIN' ? 'Configurado en la clínica' : 'Configuración del servidor' }}<span v-if="lastChanged"> · Último cambio: {{ lastChanged }}</span>
            </p>
            <UForm
              :schema="smtpSettingsSchema"
              :state="settings"
              class="space-y-4"
              @submit="save"
            >
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                  name="host"
                  label="Servidor SMTP"
                  required
                >
                  <UInput
                    v-model="settings.host"
                    class="w-full"
                    autocomplete="off"
                  />
                </UFormField>
                <UFormField
                  name="port"
                  label="Puerto"
                  required
                >
                  <UInputNumber
                    v-model="settings.port"
                    :min="1"
                    :max="65535"
                    class="w-full"
                  />
                </UFormField>
              </div>
              <UFormField
                name="security"
                label="Seguridad"
                required
              >
                <USelect
                  v-model="settings.security"
                  :items="securityOptions"
                  class="w-full"
                />
              </UFormField>
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                  name="username"
                  label="Usuario"
                >
                  <UInput
                    v-model="settings.username"
                    class="w-full"
                    autocomplete="off"
                  />
                </UFormField>
                <UFormField
                  name="password"
                  label="Contraseña"
                  description="Déjela vacía para conservar la contraseña guardada."
                >
                  <UInput
                    v-model="settings.password"
                    type="password"
                    class="w-full"
                    autocomplete="new-password"
                  />
                </UFormField>
              </div>
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                  name="fromName"
                  label="Nombre del remitente"
                >
                  <UInput
                    v-model="settings.fromName"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  name="fromAddress"
                  label="Correo del remitente"
                  required
                >
                  <UInput
                    v-model="settings.fromAddress"
                    type="email"
                    class="w-full"
                  />
                </UFormField>
              </div>
              <p class="text-xs text-muted">
                La contraseña se guarda cifrada y no vuelve a mostrarse.
              </p>
              <UAlert
                v-if="saveFeedback === 'saved'"
                color="success"
                variant="soft"
                title="Configuración guardada"
                role="status"
              />
              <UAlert
                v-else-if="saveFeedback === 'error'"
                color="error"
                variant="soft"
                title="No se pudo guardar la configuración"
                role="alert"
              />
              <UButton
                type="submit"
                :loading="saving"
                class="min-h-11"
              >
                Guardar conexión
              </UButton>
            </UForm>
          </div>
        </UCard>
      </section>
      <section aria-labelledby="test-heading">
        <UCard>
          <div class="space-y-4">
            <h2
              id="test-heading"
              class="text-lg font-semibold"
            >
              Probar envío
            </h2>
            <p class="text-sm text-muted">
              Envíe un correo de prueba a la dirección que indique. Guarde los cambios antes de probar.
            </p>
            <UForm
              :schema="smtpTestSchema"
              :state="recipient"
              class="space-y-4"
              @submit="sendTest"
            >
              <UFormField
                name="email"
                label="Correo de destino"
                required
              >
                <UInput
                  v-model="recipient.email"
                  type="email"
                  class="w-full"
                  autocomplete="email"
                />
              </UFormField>
              <UButton
                type="submit"
                color="neutral"
                variant="outline"
                :loading="testing"
                class="min-h-11"
              >
                Enviar correo de prueba
              </UButton>
            </UForm>
            <UAlert
              v-if="testFeedback === 'sent'"
              color="success"
              variant="soft"
              title="Correo de prueba enviado"
              role="status"
            />
            <UAlert
              v-else-if="testFeedback === 'limited'"
              color="warning"
              variant="soft"
              title="Espere un momento antes de volver a probar"
              role="alert"
            />
            <UAlert
              v-else-if="testFeedback === 'unavailable'"
              color="error"
              variant="soft"
              title="La prueba de correo no está disponible ahora"
              role="alert"
            />
            <UAlert
              v-else-if="testFeedback === 'failed'"
              color="error"
              variant="soft"
              :title="testError || 'No se pudo enviar el correo de prueba'"
              role="alert"
            />
          </div>
        </UCard>
      </section>
    </div>
  </UContainer>
</template>
