<script setup lang="ts">
import { staffInviteSchema } from '#shared/types/admin'

const { data: clinic, error, refresh } = await useFetch('/api/admin/clinica')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ status: error.value.statusCode, statusText: 'Acceso denegado' })
const route = useRoute()
const step = computed(() => {
  const value = Number(route.query.paso)
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : 1
})
const labels = ['Clínica', 'Marca', 'Contacto', 'Primer médico', 'Recordatorios']
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
  <UContainer class="max-w-6xl space-y-6 py-8 pb-24">
    <header>
      <p class="text-xs font-semibold tracking-wide text-muted">
        CONFIGURACIÓN INICIAL
      </p>
      <h1 class="text-2xl font-semibold">
        Prepare su clínica
      </h1>
      <p class="text-sm text-muted">
        Paso {{ step }} de 5. Guarde la clínica antes de invitar al equipo.
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
      class="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]"
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
                <span>{{ index + 1 }}</span>{{ label }}
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
          <p class="text-sm text-muted">
            Complete el nombre, la marca y el contacto en este formulario. No se guardan cambios automáticamente.
          </p>
          <AdminClinicIdentityForm
            section="all"
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
    </div>
  </UContainer>
</template>
