<script setup lang="ts">
import { staffInviteSchema, type StaffMember } from '#shared/types/admin'

const { data: users, error, status, refresh } = await useFetch<StaffMember[]>('/api/admin/usuarios')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ status: error.value.statusCode, statusText: 'Acceso denegado' })
const invite = reactive({ name: '', email: '', roles: [] as ('ADMIN' | 'DOCTOR' | 'ASSISTANT')[] })
const selected = ref<StaffMember | null>(null)
const roles = ref<('ADMIN' | 'DOCTOR' | 'ASSISTANT')[]>([])
const reactivationRoles = ref<('ADMIN' | 'DOCTOR' | 'ASSISTANT')[]>([])
const reactivationError = ref('')
const busy = ref(false)
const feedback = ref('')
const inviteOpen = ref(false)
const editorOpen = ref(false)
const confirmOpen = ref(false)
const reactivateOpen = ref(false)
const labels = { ADMIN: 'Administración', DOCTOR: 'Médico', ASSISTANT: 'Asistente' }
const options = ['ADMIN', 'DOCTOR', 'ASSISTANT'] as const
function toggleRole(list: ('ADMIN' | 'DOCTOR' | 'ASSISTANT')[], role: 'ADMIN' | 'DOCTOR' | 'ASSISTANT', checked: boolean) {
  if (checked && !list.includes(role)) list.push(role)
  if (!checked && list.includes(role)) list.splice(list.indexOf(role), 1)
}
function edit(user: StaffMember) {
  selected.value = user
  roles.value = user.roles.filter((role): role is 'ADMIN' | 'DOCTOR' | 'ASSISTANT' => role !== 'PATIENT')
  editorOpen.value = true
}
function openReactivation(user: StaffMember) {
  selected.value = user
  reactivationRoles.value = []
  reactivationError.value = ''
  reactivateOpen.value = true
}
async function reactivate() {
  if (!selected.value || busy.value) return
  if (!reactivationRoles.value.length) {
    reactivationError.value = 'Elija al menos un rol para reactivar la cuenta'
    return
  }
  busy.value = true
  reactivationError.value = ''
  feedback.value = ''
  try {
    await $fetch(`/api/admin/usuarios/${encodeURIComponent(selected.value.id)}/reactivar`, { method: 'POST', body: { roles: reactivationRoles.value } })
    reactivateOpen.value = false
    feedback.value = 'Cuenta reactivada. Los roles seleccionados ya están asignados.'
    await refresh()
  } catch {
    reactivationError.value = 'No se pudo reactivar la cuenta. Verifique su estado e intente de nuevo.'
  } finally {
    busy.value = false
  }
}
async function submitInvite() {
  const parsed = staffInviteSchema.safeParse(invite)
  if (!parsed.success || busy.value) {
    feedback.value = 'Revise los datos y elija al menos un rol'
    return
  }
  busy.value = true
  feedback.value = ''
  try {
    await $fetch('/api/auth/invite-staff', { method: 'POST', body: parsed.data })
    inviteOpen.value = false
    feedback.value = 'Solicitud de invitación recibida; la entrega no está confirmada'
    await refresh()
  } catch {
    feedback.value = 'No se pudo solicitar la invitación'
  } finally {
    busy.value = false
  }
}
async function saveRoles() {
  if (!selected.value || !roles.value.length || busy.value) return
  busy.value = true
  feedback.value = ''
  try {
    await $fetch(`/api/admin/usuarios/${encodeURIComponent(selected.value.id)}/roles`, { method: 'PUT', body: { roles: roles.value } })
    editorOpen.value = false
    feedback.value = 'Roles actualizados. Se cerraron las sesiones anteriores de esa cuenta.'
    await refresh()
  } catch {
    feedback.value = 'No se pudieron actualizar los roles; verifique que quede otro administrador'
  } finally {
    busy.value = false
  }
}
async function deactivate() {
  if (!selected.value || busy.value) return
  busy.value = true
  feedback.value = ''
  try {
    await $fetch(`/api/admin/usuarios/${encodeURIComponent(selected.value.id)}/desactivar`, { method: 'POST' })
    confirmOpen.value = false
    feedback.value = 'Cuenta desactivada'
    await refresh()
  } catch {
    feedback.value = 'No se pudo desactivar; verifique que quede otro administrador'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-6xl space-y-6 py-8 pb-24">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">
          Usuarios · equipo
        </h1><p class="text-sm text-muted">
          Solo cuentas del equipo. Las invitaciones a representantes se gestionan tras verificar su vínculo.
        </p>
      </div>
      <UButton
        icon="i-lucide-user-plus"
        class="min-h-11"
        @click="inviteOpen = true"
      >
        Invitar al equipo
      </UButton>
    </div>
    <UAlert
      v-if="feedback"
      :color="feedback.startsWith('No ') || feedback.startsWith('Revise') ? 'error' : 'success'"
      :title="feedback"
      role="status"
    />
    <UAlert
      v-if="error"
      color="error"
      title="No se pudo cargar el equipo"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <USkeleton
      v-else-if="status === 'pending'"
      class="h-60 w-full"
    />
    <UCard v-else>
      <p
        v-if="!users?.length"
        class="text-sm text-muted"
      >
        No hay cuentas del equipo.
      </p>
      <div
        v-else
        role="region"
        aria-label="Cuentas del equipo"
        tabindex="0"
        class="max-w-full overflow-x-auto"
      >
        <table class="w-full min-w-[640px] text-left text-sm">
          <caption class="sr-only">
            Cuentas del equipo y estado de acceso
          </caption>
          <thead>
            <tr class="border-b border-default text-muted">
              <th
                scope="col"
                class="p-3"
              >
                Nombre
              </th><th
                scope="col"
                class="p-3"
              >
                Correo
              </th><th
                scope="col"
                class="p-3"
              >
                Roles
              </th><th
                scope="col"
                class="p-3"
              >
                Estado
              </th><th
                scope="col"
                class="p-3"
              >
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="user in users"
              :key="user.id"
              class="border-b border-default"
            >
              <th
                scope="row"
                class="p-3 font-semibold"
              >
                {{ user.name }}
              </th><td class="p-3">
                {{ user.email }}
              </td><td class="p-3">
                {{ user.roles.length ? user.roles.map(role => labels[role as keyof typeof labels]).join(' · ') : 'Sin roles asignados' }}
              </td><td class="p-3">
                <UBadge
                  color="neutral"
                  variant="soft"
                >
                  {{ user.active ? 'Activo' : user.roles.length ? 'Pendiente de activación' : 'Desactivado' }}
                </UBadge>
              </td><td class="p-3">
                <div class="flex flex-wrap gap-2">
                  <template v-if="user.roles.length">
                    <UButton
                      variant="outline"
                      color="neutral"
                      class="min-h-11"
                      :aria-label="`Editar roles de ${user.name}`"
                      @click="edit(user)"
                    >
                      Editar roles
                    </UButton><UButton
                      color="error"
                      variant="ghost"
                      class="min-h-11"
                      :aria-label="`Desactivar cuenta de ${user.name}`"
                      @click="selected = user; confirmOpen = true"
                    >
                      Desactivar
                    </UButton>
                  </template>
                  <UButton
                    v-else
                    variant="outline"
                    color="primary"
                    class="min-h-11"
                    :aria-label="`Reactivar cuenta de ${user.name}`"
                    @click="openReactivation(user)"
                  >
                    Reactivar
                  </UButton>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UCard>
    <UModal
      v-model:open="inviteOpen"
      title="Invitar al equipo"
      description="La respuesta no confirma la entrega del correo."
    >
      <template #body>
        <form
          action="/api/auth/invite-staff"
          method="post"
          class="space-y-4"
          @submit.prevent="submitInvite"
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
          <fieldset>
            <legend class="font-medium">
              Roles
            </legend><label
              v-for="option in options"
              :key="option"
              class="flex min-h-11 items-center gap-3"
            ><input
              type="checkbox"
              name="roles"
              :value="option"
              :checked="invite.roles.includes(option)"
              @change="toggleRole(invite.roles, option, ($event.target as HTMLInputElement).checked)"
            >{{ labels[option] }}</label>
          </fieldset>
          <UButton
            type="submit"
            :loading="busy"
            :disabled="busy"
            class="min-h-11"
          >
            Enviar invitación
          </UButton>
        </form>
      </template>
    </UModal>
    <UModal
      v-model:open="editorOpen"
      :title="`Roles de ${selected?.name ?? ''}`"
    >
      <template #body>
        <form
          action="/api/admin/usuarios"
          method="post"
          class="space-y-4"
          @submit.prevent="saveRoles"
        >
          <fieldset>
            <legend class="font-medium">
              Roles del equipo
            </legend><label
              v-for="option in options"
              :key="option"
              class="flex min-h-11 items-center gap-3"
            ><input
              type="checkbox"
              name="roles"
              :value="option"
              :checked="roles.includes(option)"
              @change="toggleRole(roles, option, ($event.target as HTMLInputElement).checked)"
            >{{ labels[option] }}</label>
          </fieldset><p class="text-sm text-muted">
            Al guardar, se cierran las sesiones de esta cuenta.
          </p><UButton
            type="submit"
            :disabled="!roles.length || busy"
            :loading="busy"
            class="min-h-11"
          >
            Guardar roles
          </UButton>
        </form>
      </template>
    </UModal>
    <UModal
      v-model:open="reactivateOpen"
      :title="`Reactivar cuenta de ${selected?.name ?? ''}`"
      description="Seleccione los roles que tendrá la cuenta al reactivarla. No se recuperan automáticamente los roles anteriores."
    >
      <template #body>
        <form
          action="/api/admin/usuarios"
          method="post"
          class="space-y-4"
          @submit.prevent="reactivate"
        >
          <fieldset>
            <legend class="font-medium">
              Roles del equipo
            </legend><label
              v-for="option in options"
              :key="option"
              class="flex min-h-11 items-center gap-3"
            ><input
              type="checkbox"
              name="roles"
              :value="option"
              :checked="reactivationRoles.includes(option)"
              @change="toggleRole(reactivationRoles, option, ($event.target as HTMLInputElement).checked)"
            >{{ labels[option] }}</label>
          </fieldset>
          <UAlert
            v-if="reactivationError"
            color="error"
            :title="reactivationError"
            role="alert"
          />
          <div class="flex flex-wrap gap-3">
            <UButton
              type="button"
              color="neutral"
              variant="outline"
              class="min-h-11"
              :disabled="busy"
              @click="reactivateOpen = false"
            >
              Cancelar
            </UButton>
            <UButton
              type="submit"
              :loading="busy"
              :disabled="!reactivationRoles.length || busy"
              class="min-h-11"
            >
              Reactivar cuenta
            </UButton>
          </div>
        </form>
      </template>
    </UModal>
    <UModal
      v-model:open="confirmOpen"
      title="Desactivar cuenta"
      :description="`¿Desactivar la cuenta de ${selected?.name ?? ''}? Se cerrarán sus sesiones.`"
    >
      <template #footer>
        <div class="flex flex-wrap gap-3">
          <UButton
            color="neutral"
            variant="outline"
            class="min-h-11"
            @click="confirmOpen = false"
          >
            Cancelar
          </UButton><UButton
            color="error"
            :loading="busy"
            :disabled="busy"
            class="min-h-11"
            @click="deactivate"
          >
            Desactivar cuenta
          </UButton>
        </div>
      </template>
    </UModal>
  </UContainer>
</template>
