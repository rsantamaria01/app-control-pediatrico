<script setup lang="ts">
import type { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { smtpSettingsSchema, smtpTestSchema, type SmtpSettingsInput, type SmtpSettingsView } from '#shared/types/smtp'
import { whatsappSettingsSchema, type WhatsAppSettingsInput, type WhatsAppSettingsView } from '#shared/types/notification'

type WhatsAppStatusView = WhatsAppSettingsView & { status: 'READY' | 'NOT_CONFIGURED' | 'FAILED' }
const { data: whatsappData, error: whatsappError, status: whatsappStatus, refresh: refreshWhatsApp } = await useFetch<WhatsAppStatusView>('/api/admin/recordatorios/whatsapp')
if (whatsappError.value?.statusCode === 401 || whatsappError.value?.statusCode === 403) {
  throw createError({ status: whatsappError.value.statusCode, statusText: 'Access denied' })
}
const whatsapp = reactive({ provider: 'META' as 'META' | 'TWILIO', sender: '', template: '', accountSid: '', language: 'es', secret: '' })
watch(whatsappData, (view) => {
  if (!view) return
  Object.assign(whatsapp, { provider: view.provider ?? 'META', sender: view.sender ?? '', template: view.template ?? '', accountSid: view.accountSid ?? '', language: view.language ?? 'es', secret: '' })
}, { immediate: true })
const savingWhatsApp = ref(false)
const whatsappFeedback = ref<'saved' | 'error' | 'invalid' | null>(null)
const whatsappChangedAt = computed(() => whatsappData.value?.updatedAt ? new Intl.DateTimeFormat('es-EC', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(whatsappData.value.updatedAt)) : null)
const secretRequired = computed(() => !whatsappData.value?.configured || whatsappData.value.source !== 'ADMIN' || whatsappData.value.provider !== whatsapp.provider || whatsappData.value.sender !== whatsapp.sender || whatsappData.value.template !== whatsapp.template || (whatsapp.provider === 'META' ? whatsappData.value.language !== whatsapp.language : whatsappData.value.accountSid !== whatsapp.accountSid))

async function saveWhatsApp() {
  whatsappFeedback.value = null
  const input: WhatsAppSettingsInput = whatsapp.provider === 'META'
    ? { provider: 'META', sender: whatsapp.sender, template: whatsapp.template, language: whatsapp.language, secret: whatsapp.secret }
    : { provider: 'TWILIO', sender: whatsapp.sender, template: whatsapp.template, accountSid: whatsapp.accountSid, secret: whatsapp.secret }
  if (secretRequired.value && !input.secret.trim()) {
    whatsappFeedback.value = 'invalid'
    return
  }
  const parsed = whatsappSettingsSchema.safeParse(input)
  if (!parsed.success) {
    whatsappFeedback.value = 'invalid'
    return
  }
  savingWhatsApp.value = true
  try {
    await $fetch<WhatsAppSettingsView>('/api/admin/recordatorios/whatsapp', { method: 'PUT', body: parsed.data })
    whatsapp.secret = ''
    await refreshWhatsApp()
    whatsappFeedback.value = whatsappError.value ? 'error' : 'saved'
  } catch {
    whatsappFeedback.value = 'error'
  } finally {
    savingWhatsApp.value = false
  }
}

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
        Configure el correo saliente y el proveedor de WhatsApp para los recordatorios de la clínica.
      </p>
    </div>
    <nav
      aria-label="Secciones de la clínica"
      class="flex flex-wrap gap-2"
    >
      <UButton
        to="#marca"
        variant="outline"
        class="min-h-11"
      >
        Marca y contacto
      </UButton>
      <UButton
        to="#recordatorios"
        variant="outline"
        class="min-h-11"
      >
        Recordatorios
      </UButton>
    </nav>
    <section
      id="marca"
      aria-labelledby="brand-heading"
    >
      <UCard>
        <h2
          id="brand-heading"
          class="mb-4 text-lg font-semibold"
        >
          Marca y contacto
        </h2>
        <AdminClinicIdentityForm />
      </UCard>
    </section>
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
    <section
      id="recordatorios"
      aria-labelledby="whatsapp-heading"
    >
      <UCard>
        <div class="space-y-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2
                id="whatsapp-heading"
                class="text-lg font-semibold"
              >
                WhatsApp · recordatorios
              </h2>
              <p class="text-sm text-muted">
                Los representantes eligen este canal en su perfil. Guardar la configuración no comprueba la entrega de mensajes.
              </p>
            </div>
            <UBadge
              v-if="!whatsappError && whatsappData"
              :color="whatsappData.status === 'FAILED' ? 'error' : whatsappData.configured ? 'success' : 'neutral'"
              variant="soft"
            >
              {{ whatsappData.status === 'FAILED' ? 'Último intento fallido' : whatsappData.configured ? 'Configurado' : 'Sin configurar' }}
            </UBadge>
          </div>
          <UAlert
            v-if="whatsappError"
            color="error"
            variant="soft"
            title="No se pudo cargar la configuración de WhatsApp"
            :actions="[{ label: 'Reintentar', onClick: () => refreshWhatsApp() }]"
            role="alert"
          />
          <div
            v-else-if="whatsappStatus === 'pending' || !whatsappData"
            aria-label="Cargando configuración de WhatsApp"
          >
            <USkeleton class="h-48 w-full" />
          </div>
          <template v-else>
            <p class="text-sm text-muted">
              {{ whatsappData.source === 'ENV' ? 'Configuración del servidor: tiene prioridad y no se puede cambiar aquí.' : 'Configuración de la clínica' }}<span v-if="whatsappChangedAt"> · Último cambio: {{ whatsappChangedAt }}</span>
              <span v-if="whatsappData.status === 'FAILED'"> · El último intento con esta configuración falló; revise el proveedor antes de depender de este canal.</span>
              <span v-else-if="whatsappData.status === 'READY'"> · No hay fallo registrado para esta configuración; la entrega no está verificada.</span>
            </p>
            <p
              v-if="whatsappData.source === 'ENV'"
              class="text-sm text-muted"
            >
              Proveedor: {{ whatsappData.provider === 'META' ? 'Meta Cloud API' : whatsappData.provider === 'TWILIO' ? 'Twilio' : 'No definido' }}. Las credenciales se administran en el servidor.
            </p>
            <form
              v-else
              class="space-y-4"
              @submit.prevent="saveWhatsApp"
            >
              <fieldset
                class="space-y-2"
                :disabled="savingWhatsApp"
              >
                <legend class="text-sm font-medium">
                  Proveedor
                </legend>
                <div class="flex flex-wrap gap-4">
                  <label class="flex min-h-11 items-center gap-2">
                    <input
                      v-model="whatsapp.provider"
                      type="radio"
                      name="whatsapp-provider"
                      value="META"
                    >
                    Meta Cloud API
                  </label>
                  <label class="flex min-h-11 items-center gap-2">
                    <input
                      v-model="whatsapp.provider"
                      type="radio"
                      name="whatsapp-provider"
                      value="TWILIO"
                    >
                    Twilio
                  </label>
                </div>
              </fieldset>
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="block space-y-1 text-sm font-medium">
                  <span>{{ whatsapp.provider === 'META' ? 'Phone number ID de Meta' : 'Número remitente de Twilio (+ y código de país)' }}</span>
                  <input
                    v-model.trim="whatsapp.sender"
                    class="min-h-11 w-full rounded-md border border-default bg-default px-3 font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    name="sender"
                    autocomplete="off"
                    required
                    :pattern="whatsapp.provider === 'META' ? '[0-9]{5,30}' : '[+][1-9][0-9]{7,14}'"
                  >
                </label>
                <label class="block space-y-1 text-sm font-medium">
                  <span>{{ whatsapp.provider === 'META' ? 'Nombre de plantilla' : 'Content SID de Twilio (HX)' }}</span>
                  <input
                    v-model.trim="whatsapp.template"
                    class="min-h-11 w-full rounded-md border border-default bg-default px-3 font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    name="template"
                    autocomplete="off"
                    required
                    :pattern="whatsapp.provider === 'META' ? '[a-z][a-z0-9_]{1,100}' : 'HX[a-fA-F0-9]{32}'"
                  >
                </label>
                <label
                  v-if="whatsapp.provider === 'META'"
                  class="block space-y-1 text-sm font-medium"
                >
                  <span>Idioma de la plantilla</span>
                  <input
                    v-model.trim="whatsapp.language"
                    class="min-h-11 w-full rounded-md border border-default bg-default px-3 font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    name="language"
                    autocomplete="off"
                    required
                    pattern="[a-z]{2}(_[A-Z]{2})?"
                  >
                </label>
                <label
                  v-else
                  class="block space-y-1 text-sm font-medium"
                >
                  <span>Account SID de Twilio (AC)</span>
                  <input
                    v-model.trim="whatsapp.accountSid"
                    class="min-h-11 w-full rounded-md border border-default bg-default px-3 font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    name="accountSid"
                    autocomplete="off"
                    required
                    pattern="AC[a-fA-F0-9]{32}"
                  >
                </label>
              </div>
              <label class="block space-y-1 text-sm font-medium">
                <span>{{ whatsapp.provider === 'META' ? 'Token de acceso' : 'Auth Token de Twilio' }}</span>
                <input
                  v-model="whatsapp.secret"
                  class="min-h-11 w-full rounded-md border border-default bg-default px-3 font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  name="secret"
                  type="password"
                  autocomplete="new-password"
                  :required="secretRequired"
                  maxlength="4096"
                  :disabled="savingWhatsApp"
                >
              </label>
              <p class="text-xs text-muted">
                {{ secretRequired ? 'Ingrese un token para esta configuración.' : 'Deje el token vacío para conservar el guardado sin mostrarlo.' }} El token se guarda cifrado y no se vuelve a mostrar.
              </p>
              <UAlert
                v-if="whatsappFeedback === 'saved'"
                color="success"
                variant="soft"
                title="Configuración guardada; el envío no está verificado"
                role="status"
              />
              <UAlert
                v-else-if="whatsappFeedback === 'invalid'"
                color="error"
                variant="soft"
                title="Revise los campos y el token antes de guardar"
                role="alert"
              />
              <UAlert
                v-else-if="whatsappFeedback === 'error'"
                color="error"
                variant="soft"
                title="No se pudo guardar la configuración de WhatsApp"
                role="alert"
              />
              <UButton
                type="submit"
                :loading="savingWhatsApp"
                :disabled="savingWhatsApp"
                class="min-h-11"
              >
                Guardar conexión
              </UButton>
            </form>
          </template>
        </div>
      </UCard>
    </section>
  </UContainer>
</template>
