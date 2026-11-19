<script setup lang="ts">
import type { CommandResult, CommandSearchResults } from '../../../server/services/command-search'

const props = withDefaults(defineProps<{ compact?: boolean, shortcuts?: boolean }>(), { compact: false, shortcuts: false })
const open = ref(false)
const term = ref('')
const results = ref<CommandSearchResults>({ patients: [], screens: [], actions: [] })
const loading = ref(false)
const failed = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let requestId = 0

function onShortcut(event: KeyboardEvent) {
  if (props.shortcuts && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && !event.altKey && !event.shiftKey) {
    event.preventDefault()
    open.value = true
  }
}

onMounted(() => window.addEventListener('keydown', onShortcut))
onUnmounted(() => {
  window.removeEventListener('keydown', onShortcut)
  clearTimeout(timer)
  requestId++
})

async function load() {
  const id = ++requestId
  const search = term.value.trim()
  loading.value = true
  failed.value = false
  results.value = { patients: [], screens: [], actions: [] }
  try {
    const response = await $fetch<CommandSearchResults>('/api/search', { query: { q: search } })
    if (id === requestId && open.value && search === term.value.trim()) results.value = response
  } catch {
    if (id === requestId && open.value && search === term.value.trim()) failed.value = true
  } finally {
    if (id === requestId) loading.value = false
  }
}

watch([open, term], ([isOpen]) => {
  clearTimeout(timer)
  requestId++
  results.value = { patients: [], screens: [], actions: [] }
  failed.value = false
  loading.value = false
  if (!isOpen) {
    term.value = ''
    return
  }
  loading.value = true
  timer = setTimeout(() => {
    void load()
  }, term.value.trim() ? 250 : 0)
})

async function select(item: CommandResult) {
  open.value = false
  await navigateTo(item.to)
}

const groups = computed(() => [
  { id: 'patients', label: 'PACIENTES', ignoreFilter: true, items: results.value.patients.map(item => ({ ...item, avatar: { text: item.label.split(' ').slice(0, 2).map(part => part.charAt(0)).join('').toUpperCase() }, icon: undefined, onSelect: () => select(item) })) },
  { id: 'screens', label: 'PANTALLAS', ignoreFilter: true, items: results.value.screens.map(item => ({ ...item, onSelect: () => select(item) })) },
  { id: 'actions', label: 'ACCIONES', ignoreFilter: true, items: results.value.actions.map(item => ({ ...item, onSelect: () => select(item) })) }
].filter(group => group.items.length))
</script>

<template>
  <UButton
    icon="i-lucide-search"
    :label="compact ? undefined : 'Buscar…'"
    :aria-label="compact ? 'Buscar pacientes, pantallas y acciones' : undefined"
    color="neutral"
    variant="outline"
    class="min-h-11 min-w-11 shrink-0"
    :class="compact ? '' : 'w-48 justify-between'"
    @click="open = true"
  >
    <template
      v-if="!compact"
      #trailing
    >
      <UKbd>Ctrl K</UKbd>
    </template>
  </UButton>
  <UModal
    v-model:open="open"
    title="Buscar pacientes, pantallas y acciones"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #content>
      <div class="flex items-center justify-between px-4 pt-3">
        <label
          for="command-search-input"
          class="text-sm font-medium text-default"
        >Buscar paciente, pantalla o acción</label>
        <UKbd>Esc</UKbd>
      </div>
      <UCommandPalette
        v-model:search-term="term"
        :groups="groups"
        preserve-group-order
        :loading="loading"
        placeholder="Buscar paciente, pantalla o acción"
        :input="{ id: 'command-search-input', autocomplete: 'off' }"
        close
        class="min-h-64"
        :ui="{ viewport: 'max-h-72 overflow-y-auto', item: 'min-h-11' }"
        @update:open="open = $event"
      >
        <template #empty>
          <div
            class="space-y-3 px-4 py-8 text-center text-sm text-muted"
            aria-live="polite"
          >
            <p v-if="failed">
              No se pudo realizar la búsqueda.
            </p>
            <p v-else-if="loading">
              Buscando…
            </p>
            <p v-else-if="term.trim().length === 1">
              Escriba al menos dos caracteres para buscar pacientes.
            </p>
            <p v-else-if="term.trim()">
              Sin resultados
            </p>
            <p v-else>
              Escriba para buscar pacientes o elija una pantalla o acción.
            </p>
            <UButton
              v-if="failed"
              label="Reintentar"
              color="neutral"
              variant="outline"
              @click="load"
            />
          </div>
        </template>
      </UCommandPalette>
      <div class="flex flex-wrap justify-between gap-2 border-t border-default px-4 py-3 text-xs text-muted">
        <span>↑↓ moverse · Enter abrir · &gt; solo acciones · @ solo pacientes</span>
        <span>Solo muestra lo que tus permisos permiten</span>
      </div>
    </template>
  </UModal>
</template>
