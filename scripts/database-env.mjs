import { spawn } from 'node:child_process'

const password = process.env.DB_PASSWORD
if (!password) {
  process.stderr.write('Database password required\n')
  process.exitCode = 1
} else {
  const host = process.env.DB_HOST || 'db'
  const name = process.env.DB_NAME || 'pediatrico'
  if (!/^(?:[a-z\d-]+\.)*[a-z\d-]+$/i.test(host) || !/^[a-z\d_]+$/i.test(name)) {
    process.stderr.write('Invalid database target\n')
    process.exit(1)
  }
  const url = `postgres://pediatrico:${encodeURIComponent(password)}@${host}:5432/${name}`
  const env = { ...process.env, DATABASE_URL: url }
  delete env.DB_PASSWORD
  delete env.DB_HOST
  delete env.DB_NAME
  const child = spawn(process.argv[2], process.argv.slice(3), {
    env,
    stdio: 'inherit'
  })
  child.on('error', () => {
    process.stderr.write('Database command failed to start\n')
    process.exitCode = 1
  })
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal)
    else process.exitCode = code ?? 1
  })
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal))
  }
}
