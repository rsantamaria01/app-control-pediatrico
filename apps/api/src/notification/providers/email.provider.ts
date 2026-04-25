import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { NotificationChannel } from '@app/shared';
import { NotificationProvider } from '../notification-provider.interface';

@Injectable()
export class EmailProvider implements NotificationProvider {
  readonly channel = NotificationChannel.EMAIL;
  private transporter: nodemailer.Transporter | null = null;
  private readonly from: string;

  constructor() {
    this.from = process.env.SMTP_FROM ?? 'Pediatric Growth <no-reply@example.com>';
  }

  private ensureTransporter(): nodemailer.Transporter {
    if (this.transporter) return this.transporter;
    const host = process.env.SMTP_HOST;
    if (!host) {
      // NotificationModule should not have included this provider; guard
      // anyway so a misconfiguration surfaces as a clear runtime error
      // rather than a silent drop.
      throw new Error('EmailProvider invoked without SMTP_HOST configured');
    }
    this.transporter = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: false,
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    return this.transporter;
  }

  async send(to: string, message: string, subject = 'Pediatric Growth code'): Promise<void> {
    await this.ensureTransporter().sendMail({
      from: this.from,
      to,
      subject,
      text: message,
    });
  }
}
