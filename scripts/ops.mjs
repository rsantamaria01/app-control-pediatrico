import { spawn } from 'node:child_process'

const [command = 'db:migrate', action] = process.argv.slice(2)
const paths = {
  'db:migrate': ['node_modules/drizzle-kit/bin.cjs', 'migrate'],
  'bootstrap-admin': ['--experimental-strip-types', 'scripts/bootstrap-admin.ts'],
  'who-import': ['node_modules/tsx/dist/cli.mjs', 'scripts/import-who.ts', action]
}

if (!(command in paths) || (command === 'who-import' && !['download', 'import'].includes(action))) {
  process.stderr.write('Usage: ops db:migrate|bootstrap-admin|who-import download|import\n')
  process.exit(1)
}
if (command === 'who-import' && action === 'import' && process.env.WHO_ALLOW_CLINICAL_IMPORT !== 'yes') {
  process.stderr.write('Explicit WHO import approval required: WHO_ALLOW_CLINICAL_IMPORT=yes\n')
  process.exit(1)
}

const args = command === 'who-import' && action === 'download'
  ? paths[command]
  : ['scripts/database-env.mjs', 'node', ...paths[command]]
const env = command === 'db:migrate' ? { ...process.env, TSX_DISABLE_CACHE: '1' } : process.env
const child = spawn(process.execPath, args, { stdio: 'inherit', env })
child.on('error', () => {
  process.stderr.write('Ops command failed to start\n')
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exitCode = code ?? 1
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
