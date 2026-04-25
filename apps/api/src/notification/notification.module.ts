import { Global, Module } from '@nestjs/common';
import { NotificationChannel } from '@app/shared';
import { NotificationService } from './notification.service';
import { EmailProvider } from './providers/email.provider';
import { SmsProvider } from './providers/sms.provider';
import { WhatsAppProvider } from './providers/whatsapp.provider';
import { TelegramProvider } from './providers/telegram.provider';
import { NOTIFICATION_PROVIDER } from './notification-provider.interface';

const ALL_PROVIDERS = [EmailProvider, SmsProvider, WhatsAppProvider, TelegramProvider];

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
        const requested = (process.env.NOTIFICATION_CHANNELS ?? 'EMAIL')
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean) as NotificationChannel[];
        const all = { EMAIL: email, SMS: sms, WHATSAPP: wa, TELEGRAM: tg };
        return requested
          .map((c) => all[c as keyof typeof all])
          .filter((p): p is EmailProvider | SmsProvider | WhatsAppProvider | TelegramProvider =>
            Boolean(p),
          );
      },
    },
    NotificationService,
  ],
  exports: [NotificationService],
})
export class NotificationModule {}
