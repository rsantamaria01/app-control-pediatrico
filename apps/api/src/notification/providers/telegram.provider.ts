import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@app/shared';
import { NotificationProvider } from '../notification-provider.interface';

@Injectable()
export class TelegramProvider implements NotificationProvider {
  readonly channel = NotificationChannel.TELEGRAM;
  private readonly logger = new Logger(TelegramProvider.name);

  // TODO: wire to Telegram Bot API
  // POST https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage
  async send(to: string, message: string): Promise<void> {
    this.logger.log(`[telegram/stub] to=${to} body=${message}`);
  }
}
