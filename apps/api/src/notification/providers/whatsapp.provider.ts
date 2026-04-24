import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@app/shared';
import { NotificationProvider } from '../notification-provider.interface';

@Injectable()
export class WhatsAppProvider implements NotificationProvider {
  readonly channel = NotificationChannel.WHATSAPP;
  private readonly logger = new Logger(WhatsAppProvider.name);

  // TODO: wire to WhatsApp Business API
  // POST https://graph.facebook.com/v20.0/{phone-number-id}/messages
  // Authorization: Bearer ${process.env.WHATSAPP_API_KEY}
  async send(to: string, message: string): Promise<void> {
    this.logger.log(`[whatsapp/stub] to=${to} body=${message}`);
  }
}
