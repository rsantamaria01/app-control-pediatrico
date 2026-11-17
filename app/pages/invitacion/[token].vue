<script setup lang="ts">
const route = useRoute()
const username = ref('')
const password = ref('')
const status = ref('')
const strength = computed(() => password.value.length >= 24 ? 'Fuerte' : password.value.length >= 14 ? 'Aceptable' : 'Débil')

async function submit() {
  status.value = ''
  if (!/^[a-z0-9._-]{3,32}$/.test(username.value.trim().toLowerCase()) || password.value.length < 10) {
    status.value = 'Revise el usuario (3 a 32 caracteres) y use una contraseña de al menos 10 caracteres.'
    return
  }
  try {
    await $fetch('/api/auth/setup', { method: 'POST', body: { token: route.params.token, username: username.value, password: password.value } })
    await navigateTo('/acceso')
  } catch {
    status.value = 'No se pudo crear el acceso. Revise el usuario y la seguridad de la contraseña; si el enlace no es válido, solicite uno nuevo.'
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
        <UFormField label="Usuario" description="De 3 a 32 caracteres: letras, números, punto, guion o guion bajo." required>
          <UInput
            v-model="username"
             autocomplete="username"
             minlength="3"
             maxlength="32"
             required
             class="w-full"
          />
        </UFormField>
        <UFormField
          label="Contraseña"
          :description="`Al menos 10 caracteres; evite contraseñas comunes. Seguridad: ${strength}`"
           required
        >
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
