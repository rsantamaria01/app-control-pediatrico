import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { NotificationChannel } from '@app/shared';
import { NotificationProvider } from '../notification-provider.interface';

@Injectable()
export class EmailProvider implements NotificationProvider {
  readonly channel = NotificationChannel.EMAIL;
  private readonly logger = new Logger(EmailProvider.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor() {
    const host = process.env.SMTP_HOST;
    this.from = process.env.SMTP_FROM ?? 'Pediatric Growth <no-reply@example.com>';
    if (!host) {
      this.logger.warn(
        'SMTP_HOST is not set. EmailProvider will log messages instead of sending.',
      );
      this.transporter = null;
      return;
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }

  async send(to: string, message: string, subject = 'Pediatric Growth code'): Promise<void> {
    if (!this.transporter) {
      this.logger.log(`[email/dev] to=${to} subject="${subject}" body=${message}`);
      return;
    }
    await this.transporter.sendMail({
      from: this.from,
      to,
      subject,
      text: message,
    });
  }
}
