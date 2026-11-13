<script setup lang="ts">
const route = useRoute()
const username = ref('')
const password = ref('')
const status = ref('')
const strength = computed(() => password.value.length >= 24 ? 'Fuerte' : password.value.length >= 14 ? 'Aceptable' : 'Débil')

async function submit() {
  try {
    await $fetch('/api/auth/setup', { method: 'POST', body: { token: route.params.token, username: username.value, password: password.value } })
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
        Crear acceso
      </h1>
      <form
        class="mt-4 space-y-4"
        @submit.prevent="submit"
      >
        <UFormField label="Usuario">
          <UInput
            v-model="username"
            autocomplete="username"
            class="w-full"
          />
        </UFormField>
        <UFormField
          label="Contraseña"
          :description="`Seguridad: ${strength}`"
        >
          <UInput
            v-model="password"
            type="password"
            autocomplete="new-password"
            class="w-full"
          />
        </UFormField>
        <UButton type="submit">
          Guardar acceso
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
