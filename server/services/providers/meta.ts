import type { DomainEvent, WhatsAppTransport } from '../../../shared/types/notification'

export async function sendMetaTemplate(config: Extract<WhatsAppTransport, { provider: 'META' }>, address: string, _event: DomainEvent): Promise<'ACCEPTED' | 'FAILED'> {
  const response = await fetch(`https://graph.facebook.com/v22.0/${config.sender}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${config.secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: address.slice(1), type: 'template', template: { name: config.template, language: { code: config.language } } }),
    signal: AbortSignal.timeout(12000)
  })
  if (!response.ok) return 'FAILED'
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'messages' in body && Array.isArray(body.messages) && typeof body.messages[0]?.id === 'string' ? 'ACCEPTED' : 'FAILED'
  } catch { return 'FAILED' }
}
