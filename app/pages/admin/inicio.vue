<script setup lang="ts">
import { staffInviteSchema } from '#shared/types/admin'
import { clinicBrand } from '../../utils/clinic-brand'

const { data: clinic, error, refresh } = await useFetch('/api/admin/clinica')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ status: error.value.statusCode, statusText: 'Acceso denegado' })
const route = useRoute()
const step = computed(() => {
  const value = Number(route.query.paso)
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 1
})
const labels = ['Clínica', 'Marca', 'Contacto', 'Primer médico', 'Recordatorios']
const descriptions = ['Nombre', 'Logo y color', 'Correo de contacto', 'Invitación', 'Canales']
const section = computed(() => route.query.paso == null ? 'all' : (['clinic', 'brand', 'contact'] as const)[step.value - 1] ?? 'all')
const config = useRuntimeConfig()
const savedBrand = useNuxtData<{ primary: string, logo: string | null }>('clinic-brand')
const preview = computed(() => clinicBrand(savedBrand.data.value?.primary ?? config.public.clinicPrimary, savedBrand.data.value ? savedBrand.data.value.logo ?? '' : config.public.clinicLogo))
const invite = reactive({ name: '', email: '', roles: ['DOCTOR'] as ('ADMIN' | 'DOCTOR' | 'ASSISTANT')[] })
const sending = ref(false)
const inviteFeedback = ref<'sent' | 'error' | null>(null)
async function sendInvite() {
  const parsed = staffInviteSchema.safeParse(invite)
  if (!parsed.success || sending.value) return
  sending.value = true
  inviteFeedback.value = null
  try {
    await $fetch('/api/auth/invite-staff', { method: 'POST', body: parsed.data })
    inviteFeedback.value = 'sent'
  } catch {
    inviteFeedback.value = 'error'
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-7xl space-y-6 py-8 pb-24">
    <header>
      <p class="text-xs font-semibold tracking-wide text-muted">
        CONFIGURACIÓN INICIAL
      </p>
      <h1 class="text-2xl font-semibold">
        Prepare su clínica
      </h1>
      <p class="text-sm text-muted">
        Paso {{ step }} de 5 · Guarde los cambios antes de pasar al siguiente paso. El nombre y el correo son necesarios para guardar.
      </p>
    </header>
    <UAlert
      v-if="error"
      color="error"
      title="No se pudo consultar la clínica"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <div
      v-else
      class="grid min-w-0 items-start gap-5 xl:grid-cols-[13rem_minmax(0,1fr)_minmax(0,1fr)]"
    >
      <nav aria-label="Pasos de configuración">
        <UCard>
          <ol class="space-y-1">
            <li
              v-for="(label, index) in labels"
              :key="label"
            >
              <NuxtLink
                :to="{ path: '/admin/inicio', query: { paso: index + 1 } }"
                :aria-current="step === index + 1 ? 'step' : undefined"
                class="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
                :class="step === index + 1 ? 'bg-primary/10 font-semibold text-primary' : 'text-muted'"
              >
                <span
                  class="flex size-7 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-semibold text-default"
                  :class="step === index + 1 ? 'bg-primary text-inverted' : ''"
                >{{ index + 1 }}</span>
                <span class="min-w-0">
                  <span class="block">{{ label }}</span>
                  <span class="block text-xs font-normal text-muted">{{ descriptions[index] }}</span>
                </span>
              </NuxtLink>
            </li>
          </ol>
        </UCard>
      </nav>
      <UCard class="min-w-0">
        <div
          v-if="step <= 3"
          class="space-y-5"
        >
          <p
            v-if="section !== 'all'"
            class="text-sm text-muted"
          >
            Los cambios no se guardan automáticamente. El nombre y el correo son obligatorios para guardar cada paso.
          </p>
          <p
            v-else
            class="text-sm text-muted"
          >
            Complete el nombre, la marca y el correo de contacto. Guarde el formulario para continuar.
          </p>
          <UAlert
            v-if="!clinic && section !== 'all'"
            color="info"
            variant="soft"
            title="Complete primero el formulario inicial"
            description="El nombre y el correo de la clínica son necesarios para guardar por separado."
            :actions="[{ label: 'Abrir formulario inicial', to: '/admin/inicio' }]"
          />
          <AdminClinicIdentityForm
            :key="section"
            :section="section"
            @saved="refresh()"
          />
        </div>
        <div
          v-else-if="step === 4"
          class="space-y-5"
        >
          <h2 class="text-lg font-semibold">
            Invitar al primer médico
          </h2>
          <p class="text-sm text-muted">
            La invitación se envía por correo. La respuesta no confirma la entrega; consulte el estado del proveedor en Clínica.
          </p>
          <form
            action="/api/auth/invite-staff"
            method="post"
            class="space-y-4"
            @submit.prevent="sendInvite"
          >
            <UFormField
              label="Nombre"
              required
            >
              <UInput
                v-model="invite.name"
                name="name"
                autocomplete="name"
                class="w-full"
                size="xl"
                required
                maxlength="160"
              />
            </UFormField>
            <UFormField
              label="Correo"
              required
            >
              <UInput
                v-model="invite.email"
                name="email"
                type="email"
                autocomplete="email"
                class="w-full"
                size="xl"
                required
                maxlength="254"
              />
            </UFormField>
            <UAlert
              v-if="inviteFeedback === 'sent'"
              role="status"
              color="success"
              title="Solicitud de invitación recibida"
            />
            <UAlert
              v-if="inviteFeedback === 'error'"
              role="alert"
              color="error"
              title="No se pudo solicitar la invitación"
            />
            <UButton
              type="submit"
              :loading="sending"
              :disabled="sending || !clinic"
              class="min-h-11"
            >
              Invitar médico
            </UButton>
          </form>
        </div>
        <div
          v-else
          class="space-y-4"
        >
          <h2 class="text-lg font-semibold">
            Recordatorios
          </h2>
          <p class="text-sm text-muted">
            Configure los proveedores de correo y WhatsApp en la clínica. No se habilita ninguna entrega automáticamente.
          </p>
          <UButton
            to="/admin/clinica#recordatorios"
            class="min-h-11"
          >
            Configurar proveedores
          </UButton>
        </div>
        <nav
          aria-label="Continuar configuración"
          class="mt-6 flex flex-wrap justify-between gap-3 border-t border-default pt-4"
        >
          <UButton
            v-if="step > 1"
            :to="{ path: '/admin/inicio', query: { paso: step - 1 } }"
            color="neutral"
            variant="outline"
            class="min-h-11"
          >
            Atrás
          </UButton>
          <UButton
            v-if="step < 5"
            :to="{ path: '/admin/inicio', query: { paso: step + 1 } }"
            variant="outline"
            class="min-h-11"
          >
            Siguiente paso
          </UButton>
          <UButton
            v-else
            to="/admin/usuarios"
            variant="outline"
            class="min-h-11"
          >
            Ir a usuarios
          </UButton>
        </nav>
      </UCard>
      <UCard
        v-if="step <= 3"
        class="min-w-0"
      >
        <section
          aria-label="Vista previa de la marca aplicada"
          class="space-y-3"
        >
          <p class="text-xs font-semibold tracking-wide text-muted">
            VISTA PREVIA DE LA MARCA APLICADA
          </p>
          <div class="overflow-hidden rounded-xl border border-default bg-muted">
            <div class="grid min-h-72 grid-cols-[minmax(0,6rem)_minmax(0,1fr)] sm:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]">
              <div class="space-y-3 border-r border-default bg-default p-3">
                <div class="flex flex-wrap items-center gap-2">
                  <img
                    :src="preview.logo"
                    alt="Logo aplicado de la clínica"
                    class="size-8 rounded-md object-contain"
                  >
                  <span class="min-w-0 break-words text-xs font-semibold">{{ clinic?.name || 'Clínica sin configurar' }}</span>
                </div>
                <div class="rounded-md bg-primary/10 px-2 py-2 text-xs font-semibold text-primary">
                  Inicio
                </div>
                <div class="px-2 text-xs text-muted">
                  Pacientes
                </div>
                <div class="px-2 text-xs text-muted">
                  Agenda
                </div>
              </div>
              <div class="min-w-0 space-y-3 p-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <strong class="text-sm">Inicio</strong>
                  <span class="rounded-md bg-primary px-2 py-2 text-xs font-semibold text-inverted">Nuevo paciente</span>
                </div>
                <div class="rounded-lg border border-default bg-default p-3">
                  <p class="text-xs font-semibold">
                    Colores clínicos
                  </p>
                  <p class="mt-1 text-xs text-muted">
                    Los resultados Z y las curvas mantienen sus colores fijos; no siguen la marca.
                  </p>
                </div>
                <div class="border-b-2 border-primary px-2 py-2 text-xs font-semibold text-primary">
                  Crecimiento
                </div>
                <div
                  class="min-h-16 rounded-lg border border-default bg-default"
                  aria-hidden="true"
                />
              </div>
            </div>
          </div>
          <p class="text-xs text-muted">
            Vista previa de la marca aplicada en la aplicación. Guarde el formulario para actualizarla; los cambios sin guardar no aparecen aquí.
          </p>
        </section>
      </UCard>
    </div>
  </UContainer>
</template>
