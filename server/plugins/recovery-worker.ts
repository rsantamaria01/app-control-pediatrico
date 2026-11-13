import { defineNitroPlugin } from 'nitropack/runtime'
import { acquireRecoveryWorker, processRecoveryJobs, reconcileRecoveryJobs } from '../services/recovery'

export default defineNitroPlugin((nitroApp) => {
  let running = false
  let ready = false
  let release: (() => Promise<void>) | null = null
  let isActive: (() => Promise<boolean>) | null = null
  const timer = setInterval(async () => {
    if (running) return
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
    } catch {
      ready = false
      console.error(JSON.stringify({ event: 'recovery_worker_failed', errorClass: 'WorkerError' }))
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
