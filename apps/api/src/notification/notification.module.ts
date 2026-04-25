import { Global, Module } from '@nestjs/common';
import { NotificationChannel } from '@app/shared';
import { NotificationService } from './notification.service';
import { EmailProvider } from './providers/email.provider';
import { SmsProvider } from './providers/sms.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { TelegramProvider } from './providers/telegram.provider';
import { NOTIFICATION_PROVIDER } from './notification-provider.interface';

const ALL_PROVIDERS = [EmailProvider, SmsProvider, WhatsAppProvider, TelegramProvider];

/**
 * Each channel is enabled iff its credentials env vars are present.
 * If none are configured the system runs without OTPs — the doctor or
 * admin asserts contact ownership when registering the patient and the
 * parent signs in by password.
 */
function isChannelConfigured(channel: NotificationChannel, env = process.env): boolean {
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

@Global()
@Module({
  providers: [
    EmailProvider,
    SmsProvider,
    WhatsAppProvider,
    TelegramProvider,
    {
      provide: NOTIFICATION_PROVIDER,
      inject: ALL_PROVIDERS,
      useFactory: (
        email: EmailProvider,
        sms: SmsProvider,
        wa: WhatsAppProvider,
        tg: TelegramProvider,
      ) => {
        const all: Array<EmailProvider | SmsProvider | WhatsAppProvider | TelegramProvider> = [
          email,
          sms,
          wa,
          tg,
        ];
        return all.filter((p) => isChannelConfigured(p.channel));
      },
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
