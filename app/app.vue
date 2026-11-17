<script setup lang="ts">
import { es } from '@nuxt/ui/locale'
import { clinicBrand } from './utils/clinic-brand'

const locale = extendLocale(es, { code: 'es-EC' })
const config = useRuntimeConfig()
const brand = clinicBrand(config.public.clinicPrimary, config.public.clinicLogo)
updateAppConfig({ ui: { colors: { primary: brand.primary } } })
const online = ref(true)
const route = useRoute()
const { user, loggedIn, fetchSession, signOut } = useUserSession()
const { data: navigation, refresh: refreshNavigation } = await useFetch<{ label: string, to: string }[]>('/api/auth/navigation', { default: () => [] })
const publicPage = computed(() => /^\/(acceso|recuperar|restablecer|invitacion|reservar|privacidad|sin-conexion|sesion-expirada|403)(\/|$)/.test(route.path))
const isDoctor = computed(() => navigation.value.some(item => item.to === '/pacientes'))
const isParent = computed(() => navigation.value.some(item => item.to === '/citas'))
const isAdmin = computed(() => navigation.value.some(item => item.to.startsWith('/admin/')))
const staffItems = computed(() => navigation.value.filter(item => !item.to.startsWith('/admin/')))
const adminItems = computed(() => navigation.value.filter(item => item.to.startsWith('/admin/')))
const visibleItems = computed(() => isParent.value ? navigation.value.filter(item => ['/', '/citas', '/avisos', '/perfil'].includes(item.to)) : staffItems.value)
const icons: Record<string, string> = { '/': 'i-lucide-house', '/pacientes': 'i-lucide-users-round', '/agenda': 'i-lucide-calendar-days', '/agenda/horarios': 'i-lucide-clock', '/avisos': 'i-lucide-bell', '/perfil': 'i-lucide-user-round', '/citas': 'i-lucide-calendar-days', '/admin/clinica': 'i-lucide-settings', '/admin/catalogos': 'i-lucide-book-open' }
const navItems = computed(() => visibleItems.value.map(item => ({ ...item, icon: icons[item.to], active: route.path === item.to || (item.to !== '/' && route.path.startsWith(`${item.to}/`)) })))
const adminNavItems = computed(() => adminItems.value.map(item => ({ ...item, icon: icons[item.to], active: route.path === item.to })))
const pageTitle = computed(() => ({ '/': 'Inicio', '/pacientes': 'Pacientes', '/pacientes/nuevo': 'Nuevo paciente', '/agenda': 'Agenda', '/agenda/horarios': 'Horarios', '/agenda/solicitudes': 'Solicitudes', '/avisos': 'Avisos', '/perfil': 'Perfil', '/admin/clinica': 'Clínica', '/admin/catalogos': 'Catálogos' })[route.path] ?? (route.path.startsWith('/pacientes/') ? 'Ficha del paciente' : 'Control Pediátrico'))
const search = ref('')
const searchInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
const collapsed = ref(false)
const pageAction = computed(() => route.path === '/' || route.path === '/pacientes' ? { label: 'Nuevo paciente', to: '/pacientes/nuevo' } : null)
const clinicName = 'Control Pediátrico'

watch(loggedIn, async () => { await refreshNavigation() })
watch(() => route.path, async () => { if (import.meta.client) await refreshNavigation() })
async function logout() {
  await signOut({ onSuccess: async () => {
    await refreshNavigation()
    await navigateTo('/acceso')
  } })
}
function searchPatients() {
  if (search.value.trim()) navigateTo({ path: '/pacientes', query: { q: search.value.trim() } })
}
function onShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && isDoctor.value) {
    event.preventDefault()
    searchInput.value?.inputRef?.focus()
  }
}

const updateConnection = () => {
  online.value = navigator.onLine
}

onMounted(() => {
  updateConnection()
  window.addEventListener('online', updateConnection)
  window.addEventListener('offline', updateConnection)
  window.addEventListener('keydown', onShortcut)
  void fetchSession({ force: true }).then(() => refreshNavigation())
})

onUnmounted(() => {
  window.removeEventListener('online', updateConnection)
  window.removeEventListener('offline', updateConnection)
  window.removeEventListener('keydown', onShortcut)
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

    <template v-if="!online">
      <UContainer class="py-12">
        <UCard>
          <h1 class="text-2xl font-semibold">Sin conexión</h1>
          <p class="mt-2 text-muted">Conéctese a internet para consultar la información. No se guardan datos clínicos en este dispositivo.</p>
        </UCard>
      </UContainer>
    </template>
    <NuxtPage v-else-if="publicPage" />
    <template v-else-if="isParent">
      <UHeader :title="clinicName" :toggle="false" class="hidden lg:flex">
        <template #title>
          <span class="inline-flex items-center gap-2"><img :src="brand.logo" alt="Logo de la clínica" class="size-8">{{ clinicName }}</span>
        </template>
        <template #right>
          <UNavigationMenu :items="navItems" />
          <UColorModeButton aria-label="Cambiar tema" />
          <UButton icon="i-lucide-log-out" variant="ghost" color="neutral" aria-label="Cerrar sesión" @click="logout" />
        </template>
      </UHeader>
      <main class="min-h-dvh bg-muted pb-24 lg:pb-0"><NuxtPage /></main>
    </template>
    <UDashboardGroup v-else-if="navigation?.length" storage-key="clinical-dashboard">
      <UDashboardSidebar v-model:collapsed="collapsed" collapsible :resizable="false" class="hidden lg:flex" :ui="{ root: 'lg:w-64', footer: 'border-t border-default' }">
        <template #header="{ collapsed: isCollapsed }">
          <NuxtLink to="/" class="flex items-center gap-2 px-2 py-1 font-semibold text-default">
            <img :src="brand.logo" alt="Logo de la clínica" class="size-8 shrink-0">
            <span v-if="!isCollapsed" class="min-w-0 text-sm">{{ clinicName }}<span class="block text-xs font-normal text-muted">Pediatría</span></span>
          </NuxtLink>
        </template>
        <template #default="{ collapsed: isCollapsed }">
          <UNavigationMenu :items="navItems" :collapsed="isCollapsed" orientation="vertical" aria-label="Principal" />
          <div v-if="adminItems.length" class="mt-auto border-t border-default pt-3">
            <p v-if="!isCollapsed" class="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted">Administración</p>
            <UNavigationMenu :items="adminNavItems" :collapsed="isCollapsed" orientation="vertical" aria-label="Administración" />
          </div>
        </template>
        <template #footer="{ collapsed: isCollapsed }">
          <div class="flex items-center gap-2 px-2 py-2">
            <UAvatar :text="user?.name?.slice(0, 2).toUpperCase() || 'CP'" size="sm" />
            <div v-if="!isCollapsed" class="min-w-0 flex-1"><p class="truncate text-sm font-semibold">{{ user?.name || 'Personal de la clínica' }}</p><p class="text-xs text-muted">{{ isDoctor ? 'Pediatra' : isAdmin ? 'Administración' : 'Asistente' }}</p></div>
            <UColorModeButton v-if="!isCollapsed" aria-label="Cambiar tema" />
            <UButton v-if="!isCollapsed" icon="i-lucide-log-out" variant="ghost" color="neutral" aria-label="Cerrar sesión" @click="logout" />
          </div>
        </template>
      </UDashboardSidebar>
      <UDashboardPanel class="min-w-0 bg-muted">
        <template #header>
          <UDashboardNavbar :title="pageTitle" :toggle="false" class="hidden lg:flex">
            <template #leading><UDashboardSidebarCollapse /></template>
            <template #right>
              <form v-if="isDoctor" role="search" class="hidden w-80 xl:block" @submit.prevent="searchPatients">
                <UInput ref="searchInput" v-model="search" icon="i-lucide-search" placeholder="Buscar paciente por nombre o cédula" aria-label="Buscar paciente por nombre o cédula" class="w-full">
                  <template #trailing><UKbd>Ctrl K</UKbd></template>
                </UInput>
              </form>
              <UButton v-if="navigation.some(item => item.to === '/avisos')" to="/avisos" icon="i-lucide-bell" variant="ghost" color="neutral" aria-label="Avisos" />
              <UButton v-if="pageAction" :to="pageAction.to" icon="i-lucide-plus" :label="pageAction.label" />
            </template>
          </UDashboardNavbar>
        </template>
        <template #body><main class="min-h-full bg-muted pb-24 lg:pb-0"><NuxtPage /></main></template>
      </UDashboardPanel>
    </UDashboardGroup>
    <main v-else class="min-h-dvh bg-muted"><NuxtPage /></main>
    <nav v-if="online && !publicPage && visibleItems.length" aria-label="Navegación principal" class="fixed inset-x-0 bottom-0 z-40 grid grid-flow-col border-t border-default bg-default pb-[env(safe-area-inset-bottom)] lg:hidden">
      <NuxtLink v-for="item in visibleItems" :key="item.to" :to="item.to" :aria-current="route.path === item.to ? 'page' : undefined" class="flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-center text-[11px] font-medium text-muted focus-visible:outline-2 focus-visible:outline-primary" active-class="text-primary">
        <UIcon :name="icons[item.to] || 'i-lucide-circle'" class="size-5" aria-hidden="true" />{{ item.label }}
      </NuxtLink>
    </nav>
  </UApp>
</template>
