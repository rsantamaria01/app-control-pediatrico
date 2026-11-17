<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import { clinicBrand } from '../utils/clinic-brand'

const auth = useAuthClient()
const { fetchSession } = useUserSession()
const config = useRuntimeConfig()
const brand = clinicBrand(config.public.clinicPrimary, config.public.clinicLogo)
const { data: navigation, refresh: refreshNavigation } = await useFetch<{ to: string }[]>('/api/auth/navigation', { default: () => [] })
if (navigation.value.length) await navigateTo(navigation.value.some(item => item.to === '/') ? '/' : '/admin/clinica')
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
    await fetchSession({ force: true })
    await refreshNavigation()
    const destination = navigation.value.some(item => item.to === '/') ? '/' : navigation.value.some(item => item.to === '/agenda') ? '/agenda' : '/admin/clinica'
    await navigateTo(destination)
  } catch {
    error.value = 'Usuario o contraseña incorrectos'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <main class="grid min-h-dvh bg-default lg:grid-cols-2">
    <section class="hidden flex-col justify-between bg-primary/5 p-16 lg:flex">
      <div class="flex items-center gap-3 text-xl font-bold">
        <img
          :src="brand.logo"
          alt="Logo de la clínica"
          class="size-11"
        >Control Pediátrico
      </div>
      <div class="max-w-lg">
        <h1 class="text-4xl font-bold leading-tight tracking-tight">
          El crecimiento de cada niño, claro y a tiempo.
        </h1>
        <p class="mt-4 text-base text-muted">
          Médicos registran visitas y ven las curvas de la OMS. Las familias consultan los controles compartidos, las recomendaciones y sus citas.
        </p>
      </div>
      <p class="text-sm text-muted">
        Guayaquil · con Control Pediátrico
      </p>
    </section>
    <section class="flex items-center justify-center px-6 py-12">
      <div class="w-full max-w-[400px] space-y-5">
        <div class="mb-8 flex items-center gap-2 font-semibold lg:hidden">
          <img
            :src="brand.logo"
            alt="Logo de la clínica"
            class="size-9"
          >Control Pediátrico
        </div>
        <div>
          <h2 class="text-2xl font-bold text-default">
            Ingresar
          </h2>
          <p class="mt-1 text-muted">
            Ingrese con su usuario y contraseña.
          </p>
        </div>
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
          class="inline-block text-sm text-primary"
        >¿Olvidó su contraseña?</NuxtLink>
        <div class="flex items-center gap-3 text-sm text-muted">
          <span class="h-px flex-1 bg-muted" />¿Primera vez?<span class="h-px flex-1 bg-muted" />
        </div>
        <UButton
          to="/reservar"
          block
          variant="outline"
          color="neutral"
          size="xl"
        >
          Reservar una primera cita
        </UButton>
        <p class="text-center text-sm text-muted">
          Las cuentas se crean por invitación de la clínica. <NuxtLink
            to="/privacidad"
            class="text-primary underline"
          >Privacidad</NuxtLink>
        </p>
      </div>
    </section>
  </main>
</template>
