<script setup lang="ts">
const { data: state, refresh } = await useFetch<{ available: boolean, active: { role: 'ADMIN' | 'DOCTOR' | 'ASSISTANT' | 'PATIENT', name: string | null } | null }>('/api/auth/emulacion', { default: () => ({ available: false, active: null }) })
const roles = { ADMIN: 'Administración', DOCTOR: 'Médico', ASSISTANT: 'Asistente', PATIENT: 'Representante' }
const error = ref('')
async function stop() {
  try {
    await $fetch('/api/auth/emulacion', { method: 'DELETE' })
    await refresh()
    await navigateTo('/admin/inicio', { external: true })
  } catch { error.value = 'No se pudo salir de la emulación.' }
}
defineExpose({ refresh })
</script>

<template>
  <div v-if="state?.active" role="status" class="sticky top-0 z-[90] flex min-h-12 items-center justify-center gap-3 border-b border-warning bg-warning/15 px-4 py-2 text-sm font-semibold text-highlighted">
    <span>Emulando: {{ roles[state.active.role] }}<template v-if="state.active.name"> · {{ state.active.name }}</template></span>
    <UButton color="warning" variant="outline" size="sm" class="min-h-10" @click="stop">Salir de emulación</UButton>
    <span v-if="error" role="alert">{{ error }}</span>
  </div>
</template>
