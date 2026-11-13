<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const auth = useAuthClient()
const state = reactive({ username: '', password: '' })
const pending = ref(false)
const error = ref('')
const schema = z.object({ username: z.string().min(1), password: z.string().min(1) })

async function signIn(event: FormSubmitEvent<{ username: string, password: string }>) {
  error.value = ''
  pending.value = true
  try {
    if (!auth) throw new Error('Auth unavailable')
    const response = await auth.signIn.username({ username: event.data.username.trim().toLowerCase(), password: event.data.password })
    if (response.error) throw response.error
    await navigateTo('/')
  } catch {
    error.value = 'Usuario o contraseña incorrectos'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UContainer class="flex min-h-[calc(100dvh-8rem)] items-center justify-center py-8">
    <UCard class="w-full max-w-sm">
      <h1 class="text-2xl font-bold text-default">
        Ingresar
      </h1>
      <UForm
        :schema="schema"
        :state="state"
        class="mt-5 space-y-4"
        @submit="signIn"
      >
        <UFormField
          name="username"
          label="Usuario"
          required
        >
          <UInput
            v-model="state.username"
            autocomplete="username"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <UFormField
          name="password"
          label="Contraseña"
          required
        >
          <UInput
            v-model="state.password"
            type="password"
            autocomplete="current-password"
            class="w-full"
            size="xl"
          />
        </UFormField>
        <UButton
          type="submit"
          block
          size="xl"
          :loading="pending"
        >
          Ingresar
        </UButton>
      </UForm>
      <UAlert
        v-if="error"
        class="mt-4"
        color="error"
        variant="soft"
        :description="error"
        role="alert"
      />
      <NuxtLink
        to="/recuperar"
        class="mt-4 inline-block text-sm text-primary"
      >
        ¿Olvidó su contraseña?
      </NuxtLink>
    </UCard>
  </UContainer>
</template>
