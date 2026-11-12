export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vite-pwa/nuxt'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      siteUrl: ''
    }
  },

  routeRules: {
    '/**': { prerender: false, headers: { 'cache-control': 'private, no-store, max-age=0' } },
    '/api/**': { prerender: false, headers: { 'cache-control': 'private, no-store, max-age=0' } }
  },

  future: {
    compatibilityVersion: 5
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  pwa: {
    registerType: 'autoUpdate',
    pwaAssets: {
      config: true
    },
    manifest: {
      name: 'Control Pediátrico',
      short_name: 'Pediátrico',
      description: 'Seguimiento del crecimiento infantil con los Patrones de Crecimiento de la OMS.',
      lang: 'es',
      theme_color: '#0f766e',
      background_color: '#ffffff',
      display: 'standalone',
      start_url: '/'
    },
    workbox: {
      navigateFallback: null,
      navigateFallbackDenylist: [/^\/(?:pacientes|hijos|agenda|admin|acceso|invitacion|api)(?:\/|$)/],
      globPatterns: ['**/*.{js,css,png,svg,ico,woff2}'],
      runtimeCaching: [
        {
          urlPattern: ({ request }) => request.mode === 'navigate',
          handler: 'NetworkOnly'
        },
        {
          urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
          handler: 'NetworkOnly'
        }
      ]
    },
    client: {
      installPrompt: true
    },
    devOptions: {
      enabled: false
    }
  }
})
