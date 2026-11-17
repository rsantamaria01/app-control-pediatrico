<script setup lang="ts">
import { es } from '@nuxt/ui/locale'
import { clinicBrand } from './utils/clinic-brand'

const locale = extendLocale(es, { code: 'es-EC' })
const config = useRuntimeConfig()
const brand = clinicBrand(config.public.clinicPrimary, config.public.clinicLogo)
updateAppConfig({ ui: { colors: { primary: brand.primary } } })
const online = ref(true)
const showInstall = ref(false)
const installDismissed = ref(false)
const iosInstall = ref(false)
let installEvent: Event | undefined
function onBeforeInstall(event: Event) {
  event.preventDefault()
  installEvent = event
  showInstall.value = !installDismissed.value
}
async function installApp() {
  if (installEvent && 'prompt' in installEvent) await (installEvent as Event & { prompt: () => Promise<void> }).prompt()
  showInstall.value = false
}
function dismissInstall() {
  installDismissed.value = true
  showInstall.value = false
  iosInstall.value = false
  sessionStorage.setItem('install-dismissed', 'yes')
}
const route = useRoute()
const { user, loggedIn, fetchSession, signOut } = useUserSession()
const { data: navigation, refresh: refreshNavigation } = await useFetch<{ label: string, to: string }[]>('/api/auth/navigation', { default: () => [] })
const publicPage = computed(() => /^\/(acceso|recuperar|restablecer|invitacion|reservar|privacidad|sin-conexion|sesion-expirada|403)(\/|$)/.test(route.path))
const isDoctor = computed(() => navigation.value.some(item => item.to === '/pacientes'))
const isParent = computed(() => navigation.value.some(item => item.to === '/citas'))
const isAdmin = computed(() => navigation.value.some(item => item.to.startsWith('/admin/')))
const staffItems = computed(() => navigation.value.filter(item => !item.to.startsWith('/admin/')))
const adminItems = computed(() => navigation.value.filter(item => item.to.startsWith('/admin/')))
const visibleItems = computed(() => isParent.value ? navigation.value.filter(item => ['/', '/citas', '/avisos', '/perfil'].includes(item.to)) : staffItems.value.length ? staffItems.value : adminItems.value)
const icons: Record<string, string> = { '/': 'i-lucide-house', '/pacientes': 'i-lucide-users-round', '/agenda': 'i-lucide-calendar-days', '/agenda/horarios': 'i-lucide-clock', '/avisos': 'i-lucide-bell', '/perfil': 'i-lucide-user-round', '/citas': 'i-lucide-calendar-days', '/admin/clinica': 'i-lucide-settings', '/admin/catalogos': 'i-lucide-book-open' }
const navItems = computed(() => visibleItems.value.map(item => ({ ...item, icon: icons[item.to], active: route.path === item.to || (item.to !== '/' && route.path.startsWith(`${item.to}/`)) })))
const adminNavItems = computed(() => adminItems.value.map(item => ({ ...item, icon: icons[item.to], active: route.path === item.to })))
const pageTitle = computed(() => ({ '/': 'Inicio', '/pacientes': 'Pacientes', '/pacientes/nuevo': 'Nuevo paciente', '/agenda': 'Agenda', '/agenda/horarios': 'Horarios', '/agenda/solicitudes': 'Solicitudes', '/avisos': 'Avisos', '/perfil': 'Perfil', '/admin/clinica': 'Clínica', '/admin/catalogos': 'Catálogos' })[route.path] ?? (route.path.startsWith('/pacientes/') ? 'Ficha del paciente' : 'Control Pediátrico'))
const search = ref('')
const searchInput = ref<{ inputRef?: HTMLInputElement } | null>(null)
const collapsed = ref(false)
const narrowSidebar = ref(false)
let releaseSidebarWidth: (() => void) | undefined
const pageAction = computed(() => route.path === '/' || route.path === '/pacientes' ? { label: 'Nuevo paciente', to: '/pacientes/nuevo' } : null)
const clinicName = 'Pediatría'

watch(loggedIn, async () => {
  await refreshNavigation()
})
watch(() => route.path, async () => {
  if (import.meta.client) await refreshNavigation()
})
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
  const tablet = window.matchMedia('(min-width: 1024px) and (max-width: 1199px)')
  const resizeSidebar = () => {
    narrowSidebar.value = tablet.matches
  }
  resizeSidebar()
  tablet.addEventListener('change', resizeSidebar)
  releaseSidebarWidth = () => tablet.removeEventListener('change', resizeSidebar)
  installDismissed.value = sessionStorage.getItem('install-dismissed') === 'yes'
  iosInstall.value = !installDismissed.value && /iP(hone|ad|od)/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches && loggedIn.value
  window.addEventListener('beforeinstallprompt', onBeforeInstall)
  window.addEventListener('online', updateConnection)
  window.addEventListener('offline', updateConnection)
  window.addEventListener('keydown', onShortcut)
  void fetchSession({ force: true }).then(() => refreshNavigation())
})

onUnmounted(() => {
  releaseSidebarWidth?.()
  window.removeEventListener('beforeinstallprompt', onBeforeInstall)
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

    <NuxtPage v-slot="{ Component, route: pageRoute }">
      <template v-if="!online">
        <main class="flex min-h-dvh items-center justify-center bg-default px-8 text-center">
          <div class="w-full max-w-sm space-y-4">
            <span class="mx-auto flex size-18 items-center justify-center rounded-full bg-elevated text-muted">
              <UIcon
                name="i-lucide-wifi-off"
                class="size-8"
                aria-hidden="true"
              />
            </span>
            <h1 class="text-2xl font-bold">
              Sin conexión
            </h1>
            <p class="text-muted">
              Para proteger la información de sus hijos, la app no guarda datos de salud en el teléfono. Conéctese a internet para continuar.
            </p>
            <UButton
              block
              size="xl"
              class="min-h-12"
              @click="updateConnection"
            >
              Reintentar
            </UButton>
          </div>
        </main>
      </template>
      <component
        :is="Component"
        v-else-if="/^\/(acceso|recuperar|restablecer|invitacion|reservar|privacidad|sin-conexion|sesion-expirada|403)(\/|$)/.test(pageRoute.path)"
      />
      <template v-else-if="isParent">
        <UHeader
          :title="clinicName"
          :toggle="false"
          class="hidden lg:flex"
        >
          <template #title>
            <span class="inline-flex items-center gap-2">
              <img
                :src="brand.logo"
                alt="Logo de la clínica"
                class="size-8"
              >{{ clinicName }}
            </span>
          </template>
          <template #right>
            <UNavigationMenu :items="navItems" />
            <UColorModeButton aria-label="Cambiar tema" />
            <UButton
              icon="i-lucide-log-out"
              variant="ghost"
              color="neutral"
              aria-label="Cerrar sesión"
              @click="logout"
            />
          </template>
        </UHeader>
        <main class="min-h-dvh bg-muted pb-24 lg:pb-0">
          <header
            v-if="route.path === '/'"
            class="flex h-14 items-center gap-2 border-b border-default bg-default px-4 font-semibold lg:hidden"
          >
            <img
              :src="brand.logo"
              alt=""
              class="size-7"
              aria-hidden="true"
            >
            {{ clinicName }}
          </header>
          <component :is="Component" />
        </main>
      </template>
      <UDashboardGroup
        v-else-if="navigation?.length"
        storage-key="clinical-dashboard"
      >
        <UDashboardSidebar
          :collapsed="narrowSidebar || collapsed"
          collapsible
          :resizable="false"
          class="hidden lg:flex"
          :ui="{ root: narrowSidebar || collapsed ? 'lg:w-16' : 'lg:w-64', footer: 'border-t border-default' }"
        >
          <template #header="{ collapsed: isCollapsed }">
            <NuxtLink
              to="/"
              class="flex items-center gap-2 px-2 py-1 font-semibold text-default"
            >
              <img
                :src="brand.logo"
                alt="Logo de la clínica"
                class="size-8 shrink-0"
              >
              <span
                v-if="!isCollapsed"
                class="min-w-0 text-sm"
              >{{ clinicName }}<span class="block text-xs font-normal text-muted">Control Pediátrico</span></span>
            </NuxtLink>
          </template>
          <template #default="{ collapsed: isCollapsed }">
            <UNavigationMenu
              v-if="staffItems.length"
              :items="navItems"
              :collapsed="isCollapsed"
              orientation="vertical"
              aria-label="Principal"
            />
            <div
              v-if="adminItems.length"
              class="mt-auto border-t border-default pt-3"
            >
              <p
                v-if="!isCollapsed"
                class="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-muted"
              >
                Administración
              </p>
              <UNavigationMenu
                :items="adminNavItems"
                :collapsed="isCollapsed"
                orientation="vertical"
                aria-label="Administración"
              />
            </div>
          </template>
          <template #footer="{ collapsed: isCollapsed }">
            <div
              v-if="!isCollapsed"
              class="flex items-center gap-2 px-2 py-2"
            >
              <UAvatar
                :text="user?.name?.slice(0, 2).toUpperCase() || 'CP'"
                size="sm"
              />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold">
                  {{ user?.name || 'Personal de la clínica' }}
                </p>
                <p class="text-xs text-muted">
                  {{ isDoctor ? 'Pediatra' : isAdmin ? 'Administración' : 'Asistente' }}
                </p>
              </div>
              <UColorModeButton aria-label="Cambiar tema" />
              <UButton
                icon="i-lucide-log-out"
                variant="ghost"
                color="neutral"
                aria-label="Cerrar sesión"
                @click="logout"
              />
            </div>
          </template>
        </UDashboardSidebar>
        <UDashboardPanel class="min-w-0 bg-muted">
          <template #header>
            <UDashboardNavbar
              :title="pageTitle"
              :toggle="false"
              class="hidden lg:flex"
              :ui="{ root: 'bg-default' }"
            >
              <template #leading>
                <UDashboardSidebarCollapse />
              </template>
              <template #right>
                <form
                  v-if="isDoctor"
                  role="search"
                  class="hidden w-80 xl:block"
                  @submit.prevent="searchPatients"
                >
                  <UInput
                    ref="searchInput"
                    v-model="search"
                    icon="i-lucide-search"
                    placeholder="Buscar paciente por nombre o cédula"
                    aria-label="Buscar paciente por nombre o cédula"
                    class="w-full"
                    :ui="{ base: 'min-h-10 pr-16', trailing: 'pr-2' }"
                  >
                    <template #trailing>
                      <UKbd>Ctrl K</UKbd>
                    </template>
                  </UInput>
                </form>
                <UButton
                  v-if="navigation.some(item => item.to === '/avisos')"
                  to="/avisos"
                  icon="i-lucide-bell"
                  variant="ghost"
                  color="neutral"
                  aria-label="Avisos"
                />
                <UButton
                  v-if="pageAction"
                  :to="pageAction.to"
                  icon="i-lucide-plus"
                  :label="pageAction.label"
                />
              </template>
            </UDashboardNavbar>
          </template>
          <template #body>
            <main class="min-h-full bg-muted pb-24 lg:pb-0">
              <header
                v-if="route.path === '/'"
                class="flex h-14 items-center justify-between border-b border-default bg-default px-4 lg:hidden"
              >
                <span class="flex items-center gap-2 font-semibold">
                  <img
                    :src="brand.logo"
                    alt=""
                    class="size-7"
                    aria-hidden="true"
                  >{{ clinicName }}
                </span>
                <UButton
                  to="/pacientes"
                  icon="i-lucide-search"
                  variant="ghost"
                  color="neutral"
                  aria-label="Buscar pacientes"
                  class="min-h-11 min-w-11"
                />
              </header>
              <component :is="Component" />
            </main>
          </template>
        </UDashboardPanel>
      </UDashboardGroup>
      <main
        v-else
        class="min-h-dvh bg-muted"
      >
        <component :is="Component" />
      </main>
    </NuxtPage>
    <div
      v-if="online && !publicPage && showInstall && !installDismissed"
      class="fixed inset-x-0 top-0 z-50 flex items-center gap-2 bg-primary px-4 py-2 text-sm font-semibold text-white lg:hidden"
    >
      <UIcon
        name="i-lucide-download"
        class="size-5"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1">Instale la app en su teléfono</span>
      <UButton
        color="neutral"
        variant="solid"
        size="sm"
        class="min-h-9"
        @click="installApp"
      >
        Instalar
      </UButton>
      <UButton
        icon="i-lucide-x"
        variant="ghost"
        color="neutral"
        aria-label="Cerrar aviso"
        class="min-h-9 min-w-9"
        @click="dismissInstall"
      />
    </div>
    <UModal
      v-model:open="iosInstall"
      title="Agregar a la pantalla de inicio"
      :ui="{ content: 'sm:max-w-sm' }"
    >
      <template #body>
        <ol class="space-y-4 text-sm">
          <li class="flex gap-3">
            <span class="font-bold text-primary">1</span>Toque Compartir en la barra de Safari.
          </li>
          <li class="flex gap-3">
            <span class="font-bold text-primary">2</span>Elija Agregar a inicio.
          </li>
          <li class="flex gap-3">
            <span class="font-bold text-primary">3</span>Toque Agregar. La app aparecerá con el ícono de la clínica.
          </li>
        </ol>
        <UButton
          block
          variant="outline"
          color="neutral"
          class="mt-5 min-h-11"
          @click="dismissInstall"
        >
          Entendido
        </UButton>
      </template>
    </UModal>
    <nav
      v-if="online && !publicPage && visibleItems.length"
      aria-label="Navegación principal"
      class="fixed inset-x-0 bottom-0 z-40 grid grid-flow-col border-t border-default bg-default pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <NuxtLink
        v-for="item in visibleItems"
        :key="item.to"
        :to="item.to"
        :aria-current="route.path === item.to ? 'page' : undefined"
        class="flex min-h-16 min-w-0 flex-col items-center justify-center gap-0.5 px-1 text-center text-[11px] font-medium text-muted focus-visible:outline-2 focus-visible:outline-primary"
        active-class="text-primary font-semibold"
      >
        <UIcon
          :name="icons[item.to] || 'i-lucide-circle'"
          class="size-5"
          aria-hidden="true"
        />{{ item.label }}
      </NuxtLink>
    </nav>
  </UApp>
</template>
