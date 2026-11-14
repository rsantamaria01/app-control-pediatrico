import { defineNitroPlugin } from 'nitropack/runtime'
import { acquireRecoveryWorker, processRecoveryJobs, reconcileRecoveryJobs } from '../services/recovery'

export default defineNitroPlugin((nitroApp) => {
  let running = false
  let ready = false
  let release: (() => Promise<void>) | null = null
  let isActive: (() => Promise<boolean>) | null = null
  let schemaMissing = false
  let retryAt = 0
  const timer = setInterval(async () => {
    if (running || Date.now() < retryAt) return
    running = true
    try {
      if (!ready) {
        if (!isActive) {
          const worker = await acquireRecoveryWorker()
          if (!worker) return
          release = worker.release
          isActive = worker.isActive
        }
        if (!await isActive()) {
          release = null
          isActive = null
          return
        }
        await reconcileRecoveryJobs()
        ready = true
      }
      if (!await isActive?.()) {
        ready = false
        release = null
        isActive = null
        return
      }
      await processRecoveryJobs()
      schemaMissing = false
    } catch (error) {
      ready = false
      let cause: unknown = error
      const seen = new Set<unknown>()
      while (cause && typeof cause === 'object' && !seen.has(cause)) {
        seen.add(cause)
        if ('code' in cause && cause.code === '42P01') break
        cause = 'cause' in cause ? cause.cause : null
      }
      if (cause && typeof cause === 'object' && 'code' in cause && cause.code === '42P01') {
        retryAt = Date.now() + 5000
        if (!schemaMissing) console.error(JSON.stringify({ event: 'recovery_worker_failed', errorClass: 'schema not migrated' }))
        schemaMissing = true
      } else {
        schemaMissing = false
        console.error(JSON.stringify({ event: 'recovery_worker_failed', errorClass: 'WorkerError' }))
      }
    } finally {
      running = false
    }
  }, 250)
  nitroApp.hooks.hook('close', async () => {
    clearInterval(timer)
    while (running) await new Promise(resolve => setTimeout(resolve, 50))
    await release?.()
  })
})
