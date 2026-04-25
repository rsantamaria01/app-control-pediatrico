import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { EmailProvider } from './providers/email.provider';
import { SmsProvider } from './providers/sms.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { TelegramProvider } from './providers/telegram.provider';
import { NOTIFICATION_PROVIDER } from './notification-provider.interface';
import { isChannelConfigured } from './active-channels';

const ALL_PROVIDERS = [EmailProvider, SmsProvider, WhatsAppProvider, TelegramProvider];

/**
 * Each channel is enabled iff its credentials env vars are present.
 * If none are configured the system runs without OTPs — the doctor or
 * admin asserts contact ownership when registering the patient and the
 * parent signs in by password.
 */
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
