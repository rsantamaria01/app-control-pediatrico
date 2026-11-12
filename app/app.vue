<script setup lang="ts">
const online = ref(true)

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
    lang: 'es'
  }
})

useSeoMeta({
  title: 'Control Pediátrico',
  description: 'Seguimiento del crecimiento infantil con los Patrones de Crecimiento de la OMS.'
})
</script>

<template>
  <UApp>
    <NuxtPwaManifest />

    <UHeader
      title="Control Pediátrico"
      :toggle="false"
    >
      <template #right>
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
  </UApp>
</template>
