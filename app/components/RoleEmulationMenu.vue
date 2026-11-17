<script setup lang="ts">
const { data: state, refresh } = await useFetch<{ available: boolean, active: { role: string } | null }>('/api/auth/emulacion', { key: 'role-emulation-state', default: () => ({ available: false, active: null }) })
const open = ref(false)
const search = ref('')
const guardians = ref<{ id: string, name: string, username: string | null }[]>([])
const pending = ref(false)
const error = ref('')
watch([open, search], async ([visible]) => {
  if (!visible) return
  try { guardians.value = await $fetch('/api/auth/emulacion/representantes', { query: { q: search.value } }) } catch { guardians.value = []; error.value = 'No se pudieron cargar los representantes.' }
})
const roleOptions = [{ role: 'DOCTOR', label: 'Médico' }, { role: 'ASSISTANT', label: 'Asistente' }, { role: 'ADMIN', label: 'Administración' }] as const
async function enter(role: 'ADMIN' | 'DOCTOR' | 'ASSISTANT' | 'PATIENT', guardianId?: string) {
  pending.value = true
  error.value = ''
  try {
    await $fetch('/api/auth/emulacion', { method: 'POST', body: { role, guardianId } })
    open.value = false
    await refresh()
    await navigateTo(role === 'ADMIN' ? '/admin/inicio' : role === 'ASSISTANT' ? '/agenda' : '/', { external: true })
  } catch { error.value = 'No se pudo iniciar la emulación.' } finally { pending.value = false }
}
async function exit() {
  try {
    await $fetch('/api/auth/emulacion', { method: 'DELETE' })
    await refresh()
    await navigateTo('/admin/inicio', { external: true })
  } catch { error.value = 'No se pudo salir de la emulación.' }
}
defineExpose({ refresh })
</script>

<template>
  <template v-if="state?.available">
    <UButton v-if="state.active" color="warning" variant="ghost" block class="min-h-11 justify-start" @click="exit">Salir de emulación</UButton>
    <UModal v-else v-model:open="open" title="Ver como…" description="Seleccione un rol para revisar los permisos de esa vista.">
      <UButton color="neutral" variant="ghost" block class="min-h-11 justify-start">Ver como…</UButton>
      <template #body>
        <div class="space-y-3">
          <p v-if="error" role="alert" class="text-sm text-error">{{ error }}</p>
          <UButton v-for="item in roleOptions" :key="item.role" color="neutral" variant="outline" block :disabled="pending" class="min-h-11 justify-start" @click="enter(item.role)">{{ item.label }}</UButton>
          <UFormField label="Buscar representante" name="guardian">
            <UInput v-model="search" placeholder="Nombre o usuario" class="w-full" />
          </UFormField>
          <div class="max-h-48 space-y-1 overflow-y-auto" role="group" aria-label="Representantes">
            <UButton v-for="guardian in guardians" :key="guardian.id" color="neutral" variant="ghost" block :disabled="pending" class="min-h-11 justify-start" @click="enter('PATIENT', guardian.id)">{{ guardian.name }} · {{ guardian.username }}</UButton>
            <p v-if="!guardians?.length" class="text-sm text-muted">Sin representantes activos</p>
          </div>
        </div>
      </template>
    </UModal>
  </template>
</template>
