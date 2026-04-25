import { NotificationChannel } from '@app/shared';

/**
 * A notification channel is enabled iff its credentials env vars are
 * set. Centralised so the NotificationModule and the unit tests stay
 * aligned.
 */
export function isChannelConfigured(
  channel: NotificationChannel,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  switch (channel) {
    case NotificationChannel.EMAIL:
      return Boolean(env.SMTP_HOST);
    case NotificationChannel.SMS:
      return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
    case NotificationChannel.WHATSAPP:
      return Boolean(env.WHATSAPP_API_KEY);
    case NotificationChannel.TELEGRAM:
      return Boolean(env.TELEGRAM_BOT_TOKEN);
    default:
      return false;
  }
}
