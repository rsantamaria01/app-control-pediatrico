<script setup lang="ts">
import { es } from '@nuxt/ui/locale'
import { clinicBrand } from './utils/clinic-brand'

const locale = extendLocale(es, { code: 'es-EC' })
const config = useRuntimeConfig()
const { data: savedBrand } = await useFetch<{ primary: string, logo: string | null }>('/api/public/clinica-brand', { key: 'clinic-brand' })
const brand = computed(() => clinicBrand(savedBrand.value?.primary ?? config.public.clinicPrimary, savedBrand.value ? savedBrand.value.logo ?? '' : config.public.clinicLogo))
watch(() => brand.value.primary, primary => updateAppConfig({ ui: { colors: { primary } } }), { immediate: true })
const online = ref(true)
const { data: navigation } = await useFetch<{ label: string, to: string }[]>('/api/auth/navigation')
const links = computed(() => {
  const items = navigation.value ?? []
  const admin = items.some(item => item.to === '/admin/clinica')
  return [
    ...items.filter(item => !['/admin/clinica', '/admin/usuarios'].includes(item.to)),
    ...(admin
      ? [
          { label: 'Administración', to: '/admin/inicio' },
          { label: 'Usuarios', to: '/admin/usuarios' },
          { label: 'Clínica', to: '/admin/clinica' },
          { label: 'Auditoría', to: '/admin/auditoria' }
        ]
      : []),
    ...(items.length ? [{ label: 'Perfil', to: '/perfil' }] : [])
  ]
})

const mobileLinks = computed(() => {
  const main = links.value.filter(item => ['/', '/pacientes', '/agenda', '/citas', '/admin/inicio', '/admin/usuarios', '/perfil'].includes(item.to))
  return main.slice(0, 3)
})
const moreLinks = computed(() => links.value.filter(item => !mobileLinks.value.some(main => main.to === item.to)))

const updateConnection = () => {
  online.value = navigator.onLine
}

onMounted(() => {
  updateConnection()
  window.addEventListener('online', updateConnection)
  window.addEventListener('offline', updateConnection)
})

onUnmounted(() => {
  window.removeEventListener('online', updateConnection)
  window.removeEventListener('offline', updateConnection)
})

useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { name: 'theme-color', content: '#0f766e' }
  ],
  link: [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }
  ],
  htmlAttrs: {
    lang: 'es-EC'
  }
})

useSeoMeta({
  title: 'Control Pediátrico',
  description: 'Seguimiento del crecimiento infantil con los Patrones de Crecimiento de la OMS.'
})
</script>

<template>
  <UApp :locale="locale">
    <NuxtPwaManifest />

    <UHeader
      title="Control Pediátrico"
      :toggle="false"
    >
      <template #title>
        <span class="inline-flex items-center gap-2">
          <img
            :src="brand.logo"
            alt="Logo de la clínica"
            class="size-8"
          >
          Control Pediátrico
        </span>
      </template>
      <template #right>
        <UNavigationMenu
          v-if="links.length"
          :items="links"
          class="hidden lg:flex"
        />
        <UColorModeButton aria-label="Cambiar tema" />
      </template>
    </UHeader>

    <UMain>
      <UContainer
        v-if="!online"
        class="py-12"
      >
        <UCard>
          <h1 class="text-2xl font-semibold">
            Sin conexión
          </h1>
          <p class="mt-2 text-muted">
            Conéctese a internet para consultar la información. No se guardan datos clínicos en este dispositivo.
          </p>
        </UCard>
      </UContainer>
      <NuxtPage v-else />
    </UMain>
    <nav
      v-if="online && mobileLinks.length"
      aria-label="Navegación principal"
      class="fixed inset-x-0 bottom-0 z-40 grid grid-flow-col border-t border-default bg-default pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <NuxtLink
        v-for="item in mobileLinks"
        :key="item.to"
        :to="item.to"
        class="flex min-h-14 min-w-0 items-center justify-center px-1 text-center text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-primary"
      >
        {{ item.label }}
      </NuxtLink>
      <UDropdownMenu
        v-if="moreLinks.length"
        :items="moreLinks"
        :content="{ align: 'end', side: 'top' }"
      >
        <UButton
          label="Más"
          icon="i-lucide-menu"
          color="neutral"
          variant="ghost"
          class="min-h-14 min-w-0 justify-center"
        />
      </UDropdownMenu>
    </nav>
  </UApp>
</template>
