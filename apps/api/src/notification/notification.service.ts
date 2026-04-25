import { Inject, Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '@app/shared';
import { NotificationProvider, NOTIFICATION_PROVIDER } from './notification-provider.interface';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly providers: Map<NotificationChannel, NotificationProvider>;

  constructor(@Inject(NOTIFICATION_PROVIDER) providers: NotificationProvider[]) {
    this.providers = new Map();
    for (const p of providers) {
      this.providers.set(p.channel, p);
    }
    this.logger.log(
      `Notification channels active: ${[...this.providers.keys()].join(', ') || '(none)'}`,
    );
  }

  hasChannel(channel: NotificationChannel): boolean {
    return this.providers.has(channel);
  }

  channels(): NotificationChannel[] {
    return [...this.providers.keys()];
  }

  async dispatch(
    channel: NotificationChannel,
    to: string,
    message: string,
    subject?: string,
  ): Promise<void> {
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new Error(`Notification channel ${channel} is not active`);
    }
    await provider.send(to, message, subject);
  }
}
