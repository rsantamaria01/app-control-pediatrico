import { isIP } from 'node:net'

function number(address) {
  if (isIP(address) !== 4) throw new Error('IPv4 network required')
  return address.split('.').reduce((value, octet) => ((value << 8) | Number(octet)) >>> 0, 0)
}

function address(value) {
  return [24, 16, 8, 0].map(shift => (value >>> shift) & 255).join('.')
}

function allocate(input) {
  if (!Array.isArray(input) || input.length !== 1) throw new Error('Single Docker network required')
  const [network] = input
  const configs = network?.IPAM?.Config
  if (!Array.isArray(configs) || configs.length !== 1) throw new Error('Single IPv4 subnet required')
  const [subnet, prefixText] = String(configs[0]?.Subnet).split('/')
  if (!/^(?:1[6-9]|2[0-8])$/.test(prefixText || '') || isIP(subnet) !== 4) throw new Error('Unsupported subnet size')
  const prefix = Number(prefixText)
  const mask = (0xffffffff << (32 - prefix)) >>> 0
  const base = number(subnet)
  if (((base & mask) >>> 0) !== base) throw new Error('Noncanonical subnet')
  const end = (base | (~mask >>> 0)) >>> 0
  const gateway = number(configs[0]?.Gateway)
  if (gateway <= base || gateway >= end) throw new Error('Gateway outside subnet')
  const used = new Set([gateway])
  for (const container of Object.values(network.Containers || {})) {
    const ip = String(container?.IPv4Address || '').split('/')[0]
    if (ip) used.add(number(ip))
  }
  const available = []
  for (let candidate = end - 1; candidate > base && available.length < 2; candidate--) {
    if (!used.has(candidate)) available.push(address(candidate))
  }
  if (available.length !== 2) throw new Error('Not enough free peer addresses')
  return { proxy: available[0], peer: available[1] }
}

try {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const peers = allocate(JSON.parse(input))
  process.stdout.write(process.argv[2] === '--space' ? `${peers.proxy} ${peers.peer}\n` : `${JSON.stringify(peers)}\n`)
} catch {
  process.stderr.write('Invalid Docker checkpoint network\n')
  process.exitCode = 1
}
