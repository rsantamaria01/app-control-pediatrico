<script setup lang="ts">
import { es } from '@nuxt/ui/locale'
import type { DropdownMenuItem } from '@nuxt/ui'
import { clinicBrand } from './utils/clinic-brand'

const locale = extendLocale(es, { code: 'es-EC' })
const colorMode = useColorMode()
const themeChoices = computed<DropdownMenuItem[]>(() => [
  { label: 'Claro', type: 'checkbox', checked: colorMode.preference === 'light', onSelect: () => { colorMode.preference = 'light' } },
  { label: 'Oscuro', type: 'checkbox', checked: colorMode.preference === 'dark', onSelect: () => { colorMode.preference = 'dark' } },
  { label: 'Sistema', type: 'checkbox', checked: colorMode.preference === 'system', onSelect: () => { colorMode.preference = 'system' } }
])
const config = useRuntimeConfig()
const { data: savedBrand } = await useFetch<{ name: string, primary: string, logo: string | null }>('/api/public/clinica-brand', { key: 'clinic-brand' })
const brand = computed(() => clinicBrand(savedBrand.value?.primary ?? config.public.clinicPrimary, savedBrand.value ? savedBrand.value.logo ?? '' : config.public.clinicLogo))
watch(() => brand.value.primary, primary => updateAppConfig({ ui: { colors: { primary } } }), { immediate: true })
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
const { data: emulation, refresh: refreshEmulation } = await useFetch<{ available: boolean, active: { role: string } | null }>('/api/auth/emulacion', { key: 'role-emulation-state', default: () => ({ available: false, active: null }) })
const emulationOpen = ref(false)
async function stopEmulation() {
  await $fetch('/api/auth/emulacion', { method: 'DELETE' })
  await navigateTo('/admin/inicio', { external: true })
}
const staffAccess = computed(() => navigation.value.some(item => ['/pacientes', '/agenda'].includes(item.to) || item.to.startsWith('/admin/')))
const { data: staffNotices, refresh: refreshStaffNotices } = await useFetch<{ id: string }[]>('/api/avisos/personal', { enabled: staffAccess, default: () => [] })
const readStaffIds = useState<string[]>('read-staff-notices', () => [])
onMounted(() => {
  watch(() => user.value?.id, (id) => {
    if (!id) return
    try {
      readStaffIds.value = JSON.parse(localStorage.getItem(`staff-notice-read:${id}`) ?? '[]')
    } catch {
      readStaffIds.value = []
    }
  }, { immediate: true })
})
const staffUnread = computed(() => staffNotices.value.filter(notice => !readStaffIds.value.includes(notice.id)).length)
const publicPage = computed(() => /^\/(acceso|recuperar|restablecer|invitacion|reservar|privacidad|sin-conexion|sesion-expirada|403)(\/|$)/.test(route.path))
const isDoctor = computed(() => navigation.value.some(item => item.to === '/pacientes'))
const isStaff = staffAccess
const isParent = computed(() => navigation.value.some(item => item.to === '/citas') && !isStaff.value)
const hasFamily = computed(() => navigation.value.some(item => item.to === '/citas'))
const isAdmin = computed(() => navigation.value.some(item => item.to.startsWith('/admin/')))
const isAdminPanel = computed(() => isAdmin.value && route.path.startsWith('/admin/'))
const clinicalLanding = computed(() => isDoctor.value ? '/' : navigation.value.some(item => item.to === '/agenda') ? '/agenda' : null)
const staffItems = computed(() => {
  const staff = navigation.value.filter(item => !item.to.startsWith('/admin/') && item.to !== '/citas' && item.to !== '/perfil' && !(item.to === '/' && !isDoctor.value))
  return isDoctor.value ? staff.filter(item => item.to !== '/agenda/horarios') : navigation.value.some(item => item.to === '/agenda') ? staff.filter(item => item.to !== '/') : []
})
const adminItems = computed(() => isAdmin.value
  ? [
      { label: 'Configuración inicial', to: '/admin/inicio' },
      { label: 'Usuarios', to: '/admin/usuarios' },
      { label: 'Clínica', to: '/admin/clinica' },
      { label: 'Catálogos', to: '/admin/catalogos' },
      { label: 'Auditoría', to: '/admin/auditoria' }
    ]
  : [])
const visibleItems = computed(() => isParent.value ? navigation.value.filter(item => ['/', '/citas', '/avisos'].includes(item.to)) : isAdminPanel.value || !staffItems.value.length ? adminItems.value : staffItems.value)
const mobileItems = computed(() => isAdminPanel.value || (isAdmin.value && !staffItems.value.length)
  ? adminItems.value.filter(item => ['/admin/clinica', '/admin/catalogos'].includes(item.to))
  : visibleItems.value.filter(item => item.to !== '/perfil'))
const mobileMoreItems = computed(() => {
  if (isParent.value || !isAdmin.value) return []
  const adminLinks = isAdminPanel.value || !staffItems.value.length ? adminItems.value : [{ label: 'Administración', to: '/admin/inicio' }]
  return [
    ...adminLinks.filter(item => !mobileItems.value.some(mobile => mobile.to === item.to)),
    ...(isAdminPanel.value && clinicalLanding.value ? [{ label: 'Volver a la consulta', to: clinicalLanding.value }] : [])
  ].map(item => ({ ...item, icon: item.label === 'Volver a la consulta' ? 'i-lucide-arrow-left' : item.label === 'Administración' ? 'i-lucide-settings' : icons[item.to] }))
})
const icons: Record<string, string> = { '/': 'i-lucide-house', '/pacientes': 'i-lucide-users-round', '/agenda': 'i-lucide-calendar-days', '/agenda/horarios': 'i-lucide-clock', '/avisos': 'i-lucide-bell', '/perfil': 'i-lucide-user-round', '/citas': 'i-lucide-calendar-days', '/admin/inicio': 'i-lucide-house', '/admin/usuarios': 'i-lucide-users-round', '/admin/clinica': 'i-lucide-settings', '/admin/catalogos': 'i-lucide-book-open', '/admin/auditoria': 'i-lucide-scroll-text' }
const navItems = computed(() => visibleItems.value.map(item => ({ ...item, icon: icons[item.to], badge: item.to === '/avisos' && isStaff.value && staffUnread.value ? String(staffUnread.value) : undefined, active: route.path === item.to || (item.to !== '/' && route.path.startsWith(`${item.to}/`)) })))
const staffAdminItem = [{ label: 'Administración', to: '/admin/inicio', icon: 'i-lucide-settings' }]
const pageTitle = computed(() => route.query.vista === 'familiar' && route.path === '/' && hasFamily.value ? 'Vista familiar' : ({ '/': 'Inicio', '/pacientes': 'Pacientes', '/pacientes/nuevo': 'Nuevo paciente', '/agenda': 'Agenda', '/agenda/horarios': 'Horarios', '/agenda/solicitudes': 'Solicitudes', '/avisos': 'Avisos', '/perfil': 'Perfil', '/admin/inicio': 'Configuración inicial', '/admin/usuarios': 'Usuarios', '/admin/clinica': 'Ajustes de la clínica', '/admin/catalogos': 'Catálogos', '/admin/auditoria': 'Auditoría' })[route.path] ?? (route.path.startsWith('/pacientes/') ? 'Ficha del paciente' : 'Control Pediátrico'))
const pinnedSidebar = ref(false)
const sidebarCollapsed = computed({
  get: () => !pinnedSidebar.value,
  set: (value) => { pinnedSidebar.value = !value }
})
const sidebarHover = ref(false)
const sidebarFocus = ref(false)
const sidebarDismissed = ref(false)
const sidebarExpanded = computed(() => pinnedSidebar.value || (!sidebarDismissed.value && (sidebarHover.value || sidebarFocus.value)))
let openTimer: ReturnType<typeof setTimeout> | undefined
let closeTimer: ReturnType<typeof setTimeout> | undefined
function onSidebarEnter() {
  clearTimeout(closeTimer)
  openTimer = setTimeout(() => {
    sidebarHover.value = true
  }, 150)
}
function onSidebarLeave() {
  clearTimeout(openTimer)
  closeTimer = setTimeout(() => {
    sidebarHover.value = false
    sidebarDismissed.value = false
  }, 250)
}
const userMenuItems = computed<DropdownMenuItem[][]>(() => [
  [
    { label: 'Ver perfil', icon: 'i-lucide-user-round', to: '/perfil' },
    ...(emulation.value?.available ? [{ label: emulation.value.active ? 'Salir de emulación' : 'Ver como…', icon: 'i-lucide-eye', onSelect: emulation.value.active ? stopEmulation : () => { emulationOpen.value = true } }] : []),
    ...(hasFamily.value && isStaff.value ? [{ label: 'Vista familiar', icon: 'i-lucide-house', to: '/?vista=familiar' }] : []),
    { label: 'Cambiar tema', icon: 'i-lucide-moon', children: themeChoices.value }
  ],
  [{ label: 'Cerrar sesión', icon: 'i-lucide-log-out', onSelect: logout }]
])
const pageAction = computed(() => isDoctor.value && !isAdminPanel.value && ((route.path === '/' && route.query.vista !== 'familiar') || route.path === '/pacientes') ? { label: 'Nuevo paciente', to: '/pacientes/nuevo' } : null)
const clinicName = computed(() => savedBrand.value?.name ?? 'Pediatría')

watch(loggedIn, async () => {
  await refreshNavigation()
  await refreshEmulation()
})
watch(() => route.path, async () => {
  if (import.meta.client) {
    await refreshNavigation()
    if (isStaff.value) await refreshStaffNotices()
  }
})
async function logout() {
  await signOut({ onSuccess: async () => {
    await refreshNavigation()
    await refreshEmulation()
    await navigateTo('/acceso')
  } })
}
function setSidebarPinned() {
  pinnedSidebar.value = !pinnedSidebar.value
  try {
    if (user.value?.id) localStorage.setItem(`sidebar-pinned:${user.value.id}`, pinnedSidebar.value ? 'yes' : 'no')
  } catch {
    // Sidebar pinning still works for this session when storage is unavailable.
  }
}
function onSidebarFocusOut(event: FocusEvent) {
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) sidebarFocus.value = false
}
function onSidebarEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || pinnedSidebar.value || !sidebarExpanded.value || document.querySelector('[role="menu"][data-state="open"]')) return
  sidebarDismissed.value = true
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  sidebarHover.value = false
  sidebarFocus.value = false
}
function onGlobalEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') onSidebarEscape(event)
}
onMounted(() => {
  watch(() => user.value?.id, async (id) => {
    if (!id) return
    await nextTick()
    try {
      pinnedSidebar.value = localStorage.getItem(`sidebar-pinned:${id}`) === 'yes'
    } catch {
      pinnedSidebar.value = false
    }
  }, { immediate: true })
})

const updateConnection = () => {
  online.value = navigator.onLine
}

onMounted(() => {
  updateConnection()
  installDismissed.value = sessionStorage.getItem('install-dismissed') === 'yes'
  iosInstall.value = !installDismissed.value && /iP(hone|ad|od)/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches && loggedIn.value
  window.addEventListener('beforeinstallprompt', onBeforeInstall)
  window.addEventListener('online', updateConnection)
  window.addEventListener('offline', updateConnection)
  window.addEventListener('keydown', onGlobalEscape)
  void fetchSession({ force: true }).then(() => refreshNavigation())
})

onUnmounted(() => {
  clearTimeout(openTimer)
  clearTimeout(closeTimer)
  window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  window.removeEventListener('online', updateConnection)
  window.removeEventListener('offline', updateConnection)
  window.removeEventListener('keydown', onGlobalEscape)
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
    <RoleEmulationBanner v-if="loggedIn && !publicPage && online" />
    <RoleEmulationMenu
      v-if="loggedIn && emulation?.available && !emulation?.active"
      v-model:open="emulationOpen"
    />

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
            <ShellCommandSearch shortcuts />
            <UNavigationMenu :items="navItems" />
            <UDropdownMenu :items="userMenuItems">
              <UButton
                variant="ghost"
                color="neutral"
                :aria-label="`Menú de usuario: ${user?.name || 'Representante'}`"
                aria-haspopup="menu"
              >
                <UAvatar
                  :text="user?.name?.slice(0, 2).toUpperCase() || 'CP'"
                  size="sm"
                />
              </UButton>
            </UDropdownMenu>
          </template>
        </UHeader>
        <main class="min-h-dvh bg-muted pb-24 lg:pb-0">
          <header
            class="flex h-14 items-center gap-2 border-b border-default bg-default px-4 font-semibold lg:hidden"
          >
            <img
              :src="brand.logo"
              alt=""
              class="size-7"
              aria-hidden="true"
            >
            <span class="flex-1">{{ clinicName }}</span>
            <ShellCommandSearch
              compact
              shortcuts
            />
            <UDropdownMenu
              :items="userMenuItems"
              :content="{ align: 'end' }"
            >
              <UButton
                variant="ghost"
                color="neutral"
                :aria-label="`Menú de usuario: ${user?.name || 'Representante'}`"
                aria-haspopup="menu"
              >
                <UAvatar
                  :text="user?.name?.slice(0, 2).toUpperCase() || 'CP'"
                  size="sm"
                />
              </UButton>
            </UDropdownMenu>
          </header>
          <component :is="Component" />
        </main>
      </template>
      <UDashboardGroup
        v-else-if="navigation?.length"
        storage-key="clinical-dashboard"
        unit="px"
        :persistent="false"
      >
        <UDashboardSidebar
          v-model:collapsed="sidebarCollapsed"
          :collapsed-size="64"
          :default-size="256"
          collapsible
          :resizable="false"
          class="hidden lg:flex"
          data-staff-sidebar
          :data-staff-sidebar-open="sidebarExpanded || undefined"
          :data-staff-sidebar-pinned="pinnedSidebar || undefined"
          :ui="{ root: 'lg:w-(--width)', header: 'px-2', body: 'px-2', footer: 'flex-col items-stretch border-t border-default px-2' }"
          @mouseenter="onSidebarEnter"
          @mouseleave="onSidebarLeave"
          @focusin="sidebarFocus = true"
          @focusout="onSidebarFocusOut"
          @keydown="onSidebarEscape"
        >
          <template #header>
            <div
              class="flex w-full min-w-0 items-center"
              data-sidebar-brand
            >
              <NuxtLink
                :to="isAdminPanel || !staffItems.length ? '/admin/inicio' : isDoctor ? '/' : '/agenda'"
                class="flex min-w-0 flex-1 items-center gap-2 py-1 font-semibold text-default"
                data-sidebar-brand-link
                :aria-label="clinicName"
              >
                <img
                  :src="brand.logo"
                  alt=""
                  class="size-8 shrink-0"
                  data-sidebar-brand-logo
                  aria-hidden="true"
                >
                <span
                  class="min-w-0 whitespace-nowrap text-sm"
                  data-sidebar-label
                >{{ clinicName }}<span class="block text-xs font-normal text-muted">{{ isAdminPanel || !staffItems.length ? 'Administración' : 'Control Pediátrico' }}</span></span>
              </NuxtLink>
              <UTooltip :text="pinnedSidebar ? 'Cerrar menú' : 'Abrir menú'">
                <UButton
                  :icon="pinnedSidebar ? 'i-lucide-panel-left-close' : 'i-lucide-panel-left-open'"
                  variant="ghost"
                  color="neutral"
                  :aria-label="pinnedSidebar ? 'Cerrar menú' : 'Abrir menú'"
                  :aria-pressed="pinnedSidebar"
                  class="min-h-11 min-w-11 shrink-0"
                  data-sidebar-brand-toggle
                  @click="setSidebarPinned"
                />
              </UTooltip>
            </div>
          </template>
          <template #default>
            <UNavigationMenu
              :items="navItems"
              :collapsed="!sidebarExpanded"
              :tooltip="!sidebarExpanded"
              orientation="vertical"
              :aria-label="isAdminPanel || !staffItems.length ? 'Administración' : 'Navegación principal'"
            />
            <div
              v-if="isAdminPanel && clinicalLanding"
              class="mt-auto border-t border-default pt-3"
            >
              <UNavigationMenu
                :items="[{ label: 'Volver a la consulta', to: clinicalLanding, icon: 'i-lucide-arrow-left' }]"
                :collapsed="!sidebarExpanded"
                :tooltip="!sidebarExpanded"
                orientation="vertical"
                aria-label="Volver a la consulta"
              />
            </div>
            <div
              v-else-if="isAdmin && staffItems.length && !isAdminPanel"
              class="mt-auto border-t border-default pt-3"
            >
              <UNavigationMenu
                :items="staffAdminItem"
                :collapsed="!sidebarExpanded"
                :tooltip="!sidebarExpanded"
                orientation="vertical"
                aria-label="Administración"
              />
            </div>
          </template>
          <template #footer>
            <UDropdownMenu
              :items="userMenuItems"
              :content="{ side: 'right', align: 'end' }"
            >
              <UButton
                color="neutral"
                variant="ghost"
                class="w-full min-h-11 justify-start"
                :class="sidebarExpanded ? 'px-2' : 'justify-center px-0'"
                :aria-label="`Menú de usuario: ${user?.name || 'Personal de la clínica'}`"
                aria-haspopup="menu"
              >
                <UAvatar
                  :text="user?.name?.slice(0, 2).toUpperCase() || 'CP'"
                  size="sm"
                />
                <span
                  v-if="sidebarExpanded"
                  class="min-w-0 flex-1 text-left"
                >
                  <span class="block truncate text-sm font-semibold">{{ user?.name || 'Personal de la clínica' }}</span>
                  <span class="block text-xs text-muted">{{ isDoctor ? 'Pediatra' : isAdmin ? 'Administración' : 'Asistente' }}</span>
                </span>
              </UButton>
            </UDropdownMenu>
          </template>
        </UDashboardSidebar>
        <UDashboardPanel class="min-w-0 bg-muted">
          <template #header>
            <UDashboardNavbar
              :title="pageTitle"
              :toggle="false"
              class="relative z-40 hidden lg:flex"
              :ui="{ root: 'bg-default' }"
            >
              <template #right>
                <ShellCommandSearch shortcuts />
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
                <div class="flex items-center gap-2">
                  <ShellCommandSearch
                    compact
                    shortcuts
                  />
                  <UDropdownMenu
                    :items="userMenuItems"
                    :content="{ align: 'end' }"
                  >
                    <UButton
                      variant="ghost"
                      color="neutral"
                      :aria-label="`Menú de usuario: ${user?.name || 'Personal de la clínica'}`"
                      aria-haspopup="menu"
                    >
                      <UAvatar
                        :text="user?.name?.slice(0, 2).toUpperCase() || 'CP'"
                        size="sm"
                      />
                    </UButton>
                  </UDropdownMenu>
                </div>
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
      v-if="online && !publicPage && navigation.length && showInstall && !installDismissed"
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
      v-if="online && !publicPage && mobileItems.length"
      aria-label="Navegación principal"
      class="fixed inset-x-0 bottom-0 z-40 grid grid-flow-col border-t border-default bg-default pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <NuxtLink
        v-for="item in mobileItems"
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
      <UDropdownMenu
        v-if="mobileMoreItems.length && mobileItems.length < 5"
        :items="mobileMoreItems"
        :content="{ align: 'end', side: 'top' }"
      >
        <UButton
          label="Más"
          icon="i-lucide-menu"
          color="neutral"
          variant="ghost"
          class="min-h-16 min-w-0 flex-col justify-center gap-0.5 text-[11px]"
        />
      </UDropdownMenu>
    </nav>
  </UApp>
</template>
