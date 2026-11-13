import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  use: {
    baseURL: 'http://127.0.0.1:3000'
  },
  webServer: {
    command: 'pnpm dev --host 127.0.0.1',
    env: process.env.AUTH_E2E === '1'
      ? {
          DATABASE_URL: process.env.TEST_DATABASE_URL || '',
          SMTP_HOST: '127.0.0.1',
          SMTP_PORT: '1026',
          SMTP_SECURE: 'false',
          SMTP_FROM: 'test@localhost',
          RECOVERY_QUEUE_SECRET: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
          REDIS_URL: process.env.REDIS_URL || 'redis://cache:6379'
        }
      : {},
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI && process.env.AUTH_E2E !== '1',
    timeout: 120_000
  }
})
