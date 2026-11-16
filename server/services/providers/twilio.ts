import type { DomainEvent, WhatsAppTransport } from '../../../shared/types/notification'

export async function sendTwilioTemplate(config: Extract<WhatsAppTransport, { provider: 'TWILIO' }>, address: string, _event: DomainEvent): Promise<'ACCEPTED' | 'FAILED'> {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${Buffer.from(`${config.accountSid}:${config.secret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: `whatsapp:${address}`, From: `whatsapp:${config.sender}`, ContentSid: config.template }).toString(),
    signal: AbortSignal.timeout(12000)
  })
  if (!response.ok) return 'FAILED'
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' && body !== null && 'sid' in body && typeof body.sid === 'string' && body.sid.startsWith('SM') && 'status' in body && typeof body.status === 'string' && ['accepted', 'queued', 'sending', 'sent', 'delivered'].includes(body.status) ? 'ACCEPTED' : 'FAILED'
  } catch { return 'FAILED' }
}
