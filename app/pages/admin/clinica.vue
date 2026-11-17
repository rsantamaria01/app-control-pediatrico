<script setup lang="ts">
import type { z } from 'zod'
import type { FormSubmitEvent, TabsItem } from '@nuxt/ui'
import { smtpSettingsSchema, smtpTestSchema, type SmtpSettingsInput, type SmtpSettingsView } from '#shared/types/smtp'
import { whatsappSettingsSchema, type WhatsAppSettingsInput, type WhatsAppSettingsView } from '#shared/types/notification'

type WhatsAppStatusView = WhatsAppSettingsView & { status: 'READY' | 'NOT_CONFIGURED' | 'FAILED' }
const route = useRoute()
const router = useRouter()
const tabs = [
  { label: 'Marca', value: 'marca', slot: 'marca' as const },
  { label: 'Contacto', value: 'contacto', slot: 'contacto' as const },
  { label: 'Recordatorios', value: 'recordatorios', slot: 'recordatorios' as const }
] satisfies TabsItem[]
const activeTab = ref('recordatorios')
function syncTab(hash: string) {
  activeTab.value = tabs.some(tab => `#${tab.value}` === hash) ? hash.slice(1) : 'recordatorios'
}
function selectTab(value: string | number) {
  if (typeof value !== 'string' || !tabs.some(tab => tab.value === value) || value === activeTab.value) return
  activeTab.value = value
  void router.push({ hash: `#${value}` }).catch(() => syncTab(route.hash))
}
onMounted(() => syncTab(route.hash))
watch(() => route.hash, syncTab)
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
  <div class="min-h-full bg-muted">
    <header class="bg-default pt-4 lg:pt-0">
      <UContainer class="max-w-7xl">
        <h1 class="text-xl font-bold text-default lg:sr-only">
          Ajustes de la clínica
        </h1>
      </UContainer>
    </header>
    <UTabs
      :model-value="activeTab"
      :items="tabs"
      variant="link"
      activation-mode="manual"
      :unmount-on-hide="false"
      aria-label="Secciones de la clínica"
      class="bg-default"
      :ui="{ list: 'mx-auto max-w-7xl overflow-x-auto border-b border-default bg-default px-4 sm:px-6 lg:px-8', trigger: 'min-h-11 shrink-0 px-3', content: 'bg-muted pb-24 lg:pb-8' }"
      @update:model-value="selectTab"
    >
      <template #marca>
        <UContainer class="max-w-7xl py-6">
          <section
            aria-labelledby="brand-heading"
            class="max-w-3xl rounded-xl border border-default bg-default p-4"
          >
            <h2
              id="brand-heading"
              class="mb-4 text-lg font-semibold text-default"
            >
              Marca
            </h2>
            <p class="mb-4 text-sm text-muted">
              Para guardar, el nombre y el correo deben estar configurados. Si aún no lo están, complete la <NuxtLink
                to="/admin/inicio"
                class="font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
              >configuración inicial</NuxtLink>.
            </p>
            <AdminClinicIdentityForm section="brand" />
          </section>
        </UContainer>
      </template>
      <template #contacto>
        <UContainer class="max-w-7xl py-6">
          <section
            aria-labelledby="contact-heading"
            class="max-w-3xl rounded-xl border border-default bg-default p-4"
          >
            <h2
              id="contact-heading"
              class="mb-4 text-lg font-semibold text-default"
            >
              Contacto
            </h2>
            <p class="mb-4 text-sm text-muted">
              Para guardar, el nombre y el correo deben estar configurados. Si falta alguno, complete la <NuxtLink
                to="/admin/inicio"
                class="font-semibold text-primary underline focus-visible:outline-2 focus-visible:outline-primary"
              >configuración inicial</NuxtLink>.
            </p>
            <AdminClinicIdentityForm section="contact" />
          </section>
        </UContainer>
      </template>
      <template #recordatorios>
        <UContainer class="max-w-7xl py-6">
          <div class="grid items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div class="min-w-0 space-y-5">
              <section
                aria-labelledby="channels-heading"
                class="overflow-hidden rounded-xl border border-default bg-default"
              >
                <div class="p-4">
                  <h2
                    id="channels-heading"
                    class="text-lg font-semibold text-default"
                  >
                    Canales
                  </h2>
                  <p class="text-sm text-muted">
                    Los representantes eligen sus canales en su perfil. WhatsApp solo se envía a quien lo aceptó.
                  </p>
                </div>

                <div class="border-t border-default p-4">
                  <div class="flex flex-wrap items-start gap-3 sm:flex-nowrap">
                    <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted"><UIcon
                      name="i-lucide-mail"
                      class="size-5"
                      aria-hidden="true"
                    /></span>
                    <div class="min-w-0 flex-1">
                      <h3
                        id="smtp-heading"
                        class="font-semibold text-default"
                      >
                        Email
                      </h3>
                      <p class="break-words text-sm text-muted">
                        {{ data?.fromAddress ? `Remitente: ${data.fromName || 'Clínica'} <${data.fromAddress}>` : 'Configure el correo saliente de la clínica.' }}
                      </p>
                    </div>
                    <UBadge
                      v-if="!error && status !== 'pending'"
                      :color="data?.configured ? 'success' : 'neutral'"
                      variant="soft"
                      class="shrink-0"
                    >
                      {{ data?.configured ? 'Configurado' : 'Sin configurar' }}
                    </UBadge>
                  </div>
                  <UAlert
                    v-if="error"
                    color="error"
                    variant="soft"
                    title="No se pudo cargar la configuración de correo"
                    :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
                    role="alert"
                    class="mt-4"
                  />
                  <USkeleton
                    v-else-if="status === 'pending'"
                    class="mt-4 h-32 w-full"
                    aria-label="Cargando configuración de correo"
                  />
                  <details
                    v-else
                    class="mt-4 sm:ml-[3.25rem]"
                    open
                  >
                    <summary class="min-h-11 cursor-pointer py-2 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-primary">
                      Configurar correo saliente
                    </summary>
                    <div class="space-y-5 pt-3">
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
                        <p class="flex items-center gap-2 text-xs text-dimmed">
                          <UIcon
                            name="i-lucide-lock-keyhole"
                            class="size-4 shrink-0"
                            aria-hidden="true"
                          />La contraseña se guarda cifrada y no vuelve a mostrarse.
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
                      <div class="border-t border-default pt-4">
                        <h4
                          id="test-heading"
                          class="font-semibold text-default"
                        >
                          Probar envío de correo
                        </h4>
                        <p class="mt-1 text-sm text-muted">
                          Guarde los cambios antes de enviar un correo de prueba.
                        </p>
                        <UForm
                          :schema="smtpTestSchema"
                          :state="recipient"
                          class="mt-4 flex flex-wrap items-end gap-3"
                          @submit="sendTest"
                        >
                          <UFormField
                            name="email"
                            label="Correo de destino"
                            required
                            class="min-w-0 flex-1 basis-52"
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
                          class="mt-3"
                        />
                        <UAlert
                          v-else-if="testFeedback === 'limited'"
                          color="warning"
                          variant="soft"
                          title="Espere un momento antes de volver a probar"
                          role="alert"
                          class="mt-3"
                        />
                        <UAlert
                          v-else-if="testFeedback === 'unavailable'"
                          color="error"
                          variant="soft"
                          title="La prueba de correo no está disponible ahora"
                          role="alert"
                          class="mt-3"
                        />
                        <UAlert
                          v-else-if="testFeedback === 'failed'"
                          color="error"
                          variant="soft"
                          :title="testError || 'No se pudo enviar el correo de prueba'"
                          role="alert"
                          class="mt-3"
                        />
                      </div>
                    </div>
                  </details>
                </div>

                <div class="border-t border-default p-4">
                  <div class="flex flex-wrap items-start gap-3 sm:flex-nowrap">
                    <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted"><UIcon
                      name="i-lucide-message-circle"
                      class="size-5"
                      aria-hidden="true"
                    /></span>
                    <div class="min-w-0 flex-1">
                      <h3
                        id="whatsapp-heading"
                        class="font-semibold text-default"
                      >
                        WhatsApp
                      </h3>
                      <p class="text-sm text-muted">
                        {{ whatsappData?.sender ? `Remitente: ${whatsappData.sender}` : 'Configure el proveedor de recordatorios.' }}
                      </p>
                    </div>
                    <UBadge
                      v-if="!whatsappError && whatsappData"
                      :color="whatsappData.status === 'FAILED' ? 'error' : whatsappData.configured ? 'success' : 'neutral'"
                      variant="soft"
                      class="shrink-0"
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
                    class="mt-4"
                  />
                  <USkeleton
                    v-else-if="whatsappStatus === 'pending' || !whatsappData"
                    class="mt-4 h-48 w-full"
                    aria-label="Cargando configuración de WhatsApp"
                  />
                  <div
                    v-else
                    class="mt-4 space-y-4 sm:ml-[3.25rem]"
                  >
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
                        <legend class="text-sm font-medium text-muted">
                          Proveedor
                        </legend>
                        <div class="flex flex-wrap gap-2 rounded-lg bg-elevated p-1 sm:w-fit">
                          <label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm has-[:checked]:bg-default has-[:checked]:font-semibold has-[:checked]:shadow-sm">
                            <input
                              v-model="whatsapp.provider"
                              type="radio"
                              name="whatsapp-provider"
                              value="META"
                              class="accent-primary"
                            >Meta Cloud API
                          </label>
                          <label class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-3 text-sm has-[:checked]:bg-default has-[:checked]:font-semibold has-[:checked]:shadow-sm">
                            <input
                              v-model="whatsapp.provider"
                              type="radio"
                              name="whatsapp-provider"
                              value="TWILIO"
                              class="accent-primary"
                            >Twilio
                          </label>
                        </div>
                      </fieldset>
                      <div class="grid gap-4 sm:grid-cols-2">
                        <label class="block space-y-1 text-sm font-medium text-muted">
                          <span>{{ whatsapp.provider === 'META' ? 'Phone number ID de Meta' : 'Número remitente de Twilio (+ y código de país)' }}</span>
                          <input
                            v-model.trim="whatsapp.sender"
                            class="min-h-11 w-full rounded-lg border border-accented bg-default px-3 text-base font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            name="sender"
                            autocomplete="off"
                            required
                            :pattern="whatsapp.provider === 'META' ? '[0-9]{5,30}' : '[+][1-9][0-9]{7,14}'"
                          >
                        </label>
                        <label class="block space-y-1 text-sm font-medium text-muted">
                          <span>{{ whatsapp.provider === 'META' ? 'Nombre de plantilla' : 'Content SID de Twilio (HX)' }}</span>
                          <input
                            v-model.trim="whatsapp.template"
                            class="min-h-11 w-full rounded-lg border border-accented bg-default px-3 text-base font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            name="template"
                            autocomplete="off"
                            required
                            :pattern="whatsapp.provider === 'META' ? '[a-z][a-z0-9_]{1,100}' : 'HX[a-fA-F0-9]{32}'"
                          >
                        </label>
                        <label
                          v-if="whatsapp.provider === 'META'"
                          class="block space-y-1 text-sm font-medium text-muted"
                        >
                          <span>Idioma de la plantilla</span>
                          <input
                            v-model.trim="whatsapp.language"
                            class="min-h-11 w-full rounded-lg border border-accented bg-default px-3 text-base font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            name="language"
                            autocomplete="off"
                            required
                            pattern="[a-z]{2}(_[A-Z]{2})?"
                          >
                        </label>
                        <label
                          v-else
                          class="block space-y-1 text-sm font-medium text-muted"
                        >
                          <span>Account SID de Twilio (AC)</span>
                          <input
                            v-model.trim="whatsapp.accountSid"
                            class="min-h-11 w-full rounded-lg border border-accented bg-default px-3 text-base font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            name="accountSid"
                            autocomplete="off"
                            required
                            pattern="AC[a-fA-F0-9]{32}"
                          >
                        </label>
                      </div>
                      <label class="block space-y-1 text-sm font-medium text-muted">
                        <span>{{ whatsapp.provider === 'META' ? 'Token de acceso' : 'Auth Token de Twilio' }}</span>
                        <input
                          v-model="whatsapp.secret"
                          class="min-h-11 w-full rounded-lg border border-accented bg-default px-3 text-base font-normal text-default focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          name="secret"
                          type="password"
                          autocomplete="new-password"
                          :required="secretRequired"
                          maxlength="4096"
                          :disabled="savingWhatsApp"
                        >
                      </label>
                      <p class="flex items-start gap-2 text-xs text-dimmed">
                        <UIcon
                          name="i-lucide-lock-keyhole"
                          class="size-4 shrink-0"
                          aria-hidden="true"
                        /><span>{{ secretRequired ? 'Ingrese un token para esta configuración.' : 'Deje el token vacío para conservar el guardado sin mostrarlo.' }} El token se guarda cifrado y no se vuelve a mostrar.</span>
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
                  </div>
                </div>

                <div class="flex flex-wrap items-start gap-3 border-t border-default p-4 sm:flex-nowrap">
                  <span class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated text-muted"><UIcon
                    name="i-lucide-bell"
                    class="size-5"
                    aria-hidden="true"
                  /></span>
                  <div class="min-w-0 flex-1">
                    <h3 class="font-semibold text-default">
                      En la app
                    </h3><p class="text-sm text-muted">
                      Centro de avisos y notificaciones del sistema si instalaron la app.
                    </p>
                  </div>
                </div>
              </section>

              <section
                aria-labelledby="rules-heading"
                class="rounded-xl border border-default bg-default p-4"
              >
                <h2
                  id="rules-heading"
                  class="text-lg font-semibold text-default"
                >
                  Qué recordatorios se envían
                </h2>
                <p class="mt-1 text-sm text-muted">
                  Las reglas y horarios de envío todavía no se administran desde esta pantalla. La configuración de proveedores no activa recordatorios por sí sola.
                </p>
              </section>
            </div>

            <section
              aria-labelledby="preview-heading"
              class="min-w-0 rounded-xl border border-default bg-default p-4"
            >
              <h2
                id="preview-heading"
                class="text-lg font-semibold text-default"
              >
                Vista previa
              </h2>
              <div class="mt-4 rounded-lg border border-default bg-elevated p-5 text-sm text-muted">
                La vista previa de mensajes aún no está disponible. No se muestran mensajes de ejemplo como si fueran envíos reales.
              </div>
            </section>
          </div>
        </UContainer>
      </template>
    </UTabs>
  </div>
</template>
