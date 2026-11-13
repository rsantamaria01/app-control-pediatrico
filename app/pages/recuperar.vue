<script setup lang="ts">
const identity = ref('')
const acknowledged = ref(false)
const pending = ref(false)

async function submit() {
  pending.value = true
  try {
    await $fetch('/api/auth/recovery', { method: 'POST', body: { identity: identity.value } })
  } finally {
    acknowledged.value = true
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="py-12">
    <UCard class="mx-auto max-w-sm">
      <h1 class="text-2xl font-semibold">
        Recuperar acceso
      </h1>
      <p
        v-if="acknowledged"
        role="status"
      >
        Si la cuenta existe, enviaremos instrucciones al correo registrado
      </p>
      <form
        v-else
        class="mt-4 space-y-4"
        @submit.prevent="submit"
      >
        <UFormField label="Usuario o email">
          <UInput
            v-model="identity"
            autocomplete="username"
            class="w-full"
          />
        </UFormField>
        <UButton
          type="submit"
          :loading="pending"
        >
          Solicitar instrucciones
        </UButton>
      </form>
    </UCard>
  </UContainer>
</template>
