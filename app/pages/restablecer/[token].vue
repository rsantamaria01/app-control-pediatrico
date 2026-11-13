<script setup lang="ts">
const token = useRoute().params.token
const password = ref('')
const status = ref('')
async function submit() {
  try {
    await $fetch('/api/auth/reset', { method: 'POST', body: { token, password: password.value } })
    await navigateTo('/acceso')
  } catch {
    status.value = 'El enlace venció. Solicite uno nuevo.'
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
        <UFormField label="Nueva contraseña">
          <UInput
            v-model="password"
            type="password"
            autocomplete="new-password"
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
