import { spawnSync } from 'node:child_process'

for (const args of [
  ['scripts/migrate.mjs'],
  ['node_modules/tsx/dist/cli.mjs', 'scripts/import-preventive-catalogs.ts', 'import']
]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status || 1)
}
