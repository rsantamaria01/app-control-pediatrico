<script setup lang="ts">
const { data, error, refresh } = await useFetch<{ inApp: true, email: boolean }>('/api/avisos/preferencias')
if (import.meta.server && (error.value?.statusCode === 401 || error.value?.statusCode === 403)) throw createError({ statusCode: error.value.statusCode, statusMessage: 'Acceso denegado' })
const saving = ref(false)
const saveError = ref(false)
async function updateEmail(value: boolean) {
  saving.value = true
  saveError.value = false
  try {
    data.value = await $fetch('/api/avisos/preferencias', { method: 'PUT', body: { email: value } })
  } catch {
    saveError.value = true
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UContainer class="max-w-3xl space-y-6 py-8 pb-24">
    <h1 class="text-2xl font-semibold">
      Preferencias de avisos
    </h1>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="No se pudieron cargar las preferencias"
      :actions="[{ label: 'Reintentar', onClick: () => refresh() }]"
    />
    <template v-else-if="data">
      <UAlert
        v-if="saveError"
        color="error"
        variant="soft"
        title="No se pudo guardar la preferencia"
      />
      <UCard class="space-y-4">
        <p>Los avisos en la aplicación siempre están disponibles.</p>
        <label class="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            :checked="data.email"
            :disabled="saving"
            @change="updateEmail(($event.target as HTMLInputElement).checked)"
          >
          Recibir recordatorios por correo electrónico
        </label>
        <p class="text-sm text-muted">
          El correo está desactivado hasta que usted lo autorice.
        </p>
      </UCard>
    </template>
    <UButton
      to="/avisos"
      variant="outline"
      class="min-h-11"
    >
      Ver avisos
    </UButton>
  </UContainer>
</template>
