<script setup lang="ts">
useHead({
  meta: [
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { name: 'theme-color', content: '#0f766e' }
  ],
  link: [
    { rel: 'icon', href: '/favicon.ico' }
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

    <UHeader title="Control Pediátrico">
      <template #right>
        <UColorModeButton />
      </template>
    </UHeader>

    <UMain>
      <NuxtPage />
    </UMain>
  </UApp>
</template>
