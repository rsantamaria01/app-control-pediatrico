import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@app/shared';
import { NotificationProvider } from '../notification-provider.interface';

@Injectable()
export class SmsProvider implements NotificationProvider {
  readonly channel = NotificationChannel.SMS;
  private readonly logger = new Logger(SmsProvider.name);

  // TODO: wire to Twilio.
  // const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  // await client.messages.create({ from: TWILIO_FROM, to, body: message });
  async send(to: string, message: string): Promise<void> {
    this.logger.log(`[sms/stub] to=${to} body=${message}`);
  }
}
