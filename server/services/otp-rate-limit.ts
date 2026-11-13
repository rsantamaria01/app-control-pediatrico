import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { createClient } from 'redis'

function ipv4InCidr(address: string, cidr: string) {
  const [network, prefixText] = cidr.split('/')
  if (isIP(network || '') !== 4 || !/^\d{1,2}$/.test(prefixText || '')) return false
  const bits = Number(prefixText)
  if (bits < 0 || bits > 32 || isIP(address) !== 4) return false
  const value = (ip: string) => ip.split('.').reduce((acc, part) => ((acc << 8) | Number(part)) >>> 0, 0)
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
  return (value(address) & mask) === (value(network!) & mask)
}

export function recoveryClientAddress(peer: string | undefined, forwarded: string | undefined, trustedCidr: string | undefined) {
  if (!peer || !isIP(peer)) return 'shared'
  if (!trustedCidr || !ipv4InCidr(peer, trustedCidr) || !forwarded) return peer
  const chain = forwarded.split(',').map(part => part.trim())
  if (chain.some(part => !isIP(part))) return peer
  for (const address of chain.reverse()) {
    if (!ipv4InCidr(address, trustedCidr)) return address
  }
  return peer
}

const script = `
local a = redis.call('GET', KEYS[1])
local b = redis.call('GET', KEYS[2])
if (a and tonumber(a) >= tonumber(ARGV[2])) or (b and tonumber(b) >= tonumber(ARGV[3])) then return 0 end
local first = redis.call('INCR', KEYS[1])
if first == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
local second = redis.call('INCR', KEYS[2])
if second == 1 then redis.call('EXPIRE', KEYS[2], tonumber(ARGV[1])) end
return 1
`
let client: ReturnType<typeof createClient> | undefined

async function useRedis() {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('Valkey unavailable')
  if (!client) {
    client = createClient({ url, socket: { connectTimeout: 2000, reconnectStrategy: false } })
    client.on('error', () => {})
  }
  if (!client.isOpen) await client.connect()
  return client
}

const loginReservationScript = `
if redis.call('EXISTS', KEYS[3], KEYS[4]) > 0 then return 0 end
local userCount = tonumber(redis.call('GET', KEYS[1]) or '0')
local ipCount = tonumber(redis.call('GET', KEYS[2]) or '0')
if userCount >= 3 or ipCount >= 20 then return 0 end
local userReserved = redis.call('INCR', KEYS[1])
if userReserved == 1 then redis.call('EXPIRE', KEYS[1], 60) end
local ipReserved = redis.call('INCR', KEYS[2])
if ipReserved == 1 then redis.call('EXPIRE', KEYS[2], 60) end
return 1
`

const releaseIpReservationScript = `
local count = tonumber(redis.call('GET', KEYS[1]) or '0')
if count > 0 then redis.call('DECR', KEYS[1]) end
return 1
`

const failureScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 86400) end
local threshold = tonumber(ARGV[1])
if count >= threshold then
  local level = math.min(count - threshold, 6)
  redis.call('SET', KEYS[2], '1', 'EX', 60 * (2 ^ level))
end
return count
`

function loginKeys(username: string, address: string): [string, string] {
  const userKey = `auth:login:user:${createHash('sha256').update(username.trim().toLowerCase()).digest('hex')}`
  const ipKey = `auth:login:ip:${createHash('sha256').update(isIP(address) ? address : 'shared').digest('hex')}`
  return [userKey, ipKey]
}

export async function reserveLoginAttempt(username: string, address: string) {
  const redis = await useRedis()
  const [userKey, ipKey] = loginKeys(username, address)
  return Number(await redis.eval(loginReservationScript, { keys: [`${userKey}:attempts`, `${ipKey}:attempts`, `${userKey}:locked`, `${ipKey}:locked`], arguments: [] })) === 1
}

export async function releaseSuccessfulLoginIp(address: string) {
  const redis = await useRedis()
  const [, ipKey] = loginKeys('unused', address)
  await redis.eval(releaseIpReservationScript, { keys: [`${ipKey}:attempts`], arguments: [] })
}

export async function checkLoginLock(username: string, address: string) {
  const redis = await useRedis()
  const [userKey, ipKey] = loginKeys(username, address)
  return (await redis.exists([`${userKey}:locked`, `${ipKey}:locked`])) === 0
}

export async function recordLoginFailure(username: string, address: string) {
  const redis = await useRedis()
  const [userKey, ipKey] = loginKeys(username, address)
  await redis.eval(failureScript, { keys: [userKey, `${userKey}:locked`], arguments: ['3'] })
  await redis.eval(failureScript, { keys: [ipKey, `${ipKey}:locked`], arguments: ['20'] })
}

export async function clearLoginFailures(username: string) {
  const redis = await useRedis()
  const [userKey] = loginKeys(username, 'shared')
  await redis.del([userKey, `${userKey}:locked`])
}

export async function consumeAccessLimit(email: string, address: string, action: string): Promise<boolean> {
  const redis = await useRedis()
  const digest = createHash('sha256').update(email.toLowerCase()).digest('hex')
  const key = `auth:access:${action}:email:${digest}`
  const ipKey = `auth:access:${action}:ip:${createHash('sha256').update(isIP(address) ? address : 'shared').digest('hex')}`
  return Number(await redis.eval(script, { keys: [key, ipKey], arguments: ['60', '3', action === 'recovery' ? '1000' : '20'] })) === 1
}
