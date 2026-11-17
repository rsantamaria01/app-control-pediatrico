<script setup lang="ts">
const token = useRoute().params.token
const password = ref('')
const status = ref('')
const strength = computed(() => password.value.length >= 24 ? 'Fuerte' : password.value.length >= 14 ? 'Aceptable' : 'Débil')
async function submit() {
  status.value = ''
  if (password.value.length < 10) {
    status.value = 'Use una contraseña de al menos 10 caracteres.'
    return
  }
  try {
    await $fetch('/api/auth/reset', { method: 'POST', body: { token, password: password.value } })
    await navigateTo('/acceso')
  } catch {
    status.value = 'No se pudo guardar la contraseña. Evite contraseñas comunes; si el enlace no es válido, solicite uno nuevo.'
  }
}
</script>

<template>
  <UContainer class="py-12">
    <UCard class="mx-auto max-w-sm">
      <h1 class="text-2xl font-semibold">
        Restablecer contraseña
      </h1>
      <form
        class="mt-4 space-y-4"
        @submit.prevent="submit"
      >
        <UFormField label="Nueva contraseña" :description="`Al menos 10 caracteres; evite contraseñas comunes. Seguridad: ${strength}`" required>
          <UInput
            v-model="password"
            type="password"
             autocomplete="new-password"
             minlength="10"
             required
             class="w-full"
          />
        </UFormField>
        <UButton type="submit">
          Guardar contraseña
        </UButton>
      </form>
      <UAlert
        v-if="status"
        color="error"
        :description="status"
        class="mt-4"
      />
    </UCard>
  </UContainer>
</template>
