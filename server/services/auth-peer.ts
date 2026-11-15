import type { H3Event } from 'h3'

export function applyAuthPeerAddress(event: Pick<H3Event, 'node'>) {
  const peer = event.node.req.socket.remoteAddress
  delete event.node.req.headers['x-real-ip']
  if (peer) event.node.req.headers['x-real-ip'] = peer
  return peer
}
