import type { NotificationChannel } from '@app/shared';

export interface NotificationProvider {
  channel: NotificationChannel;
  send(to: string, message: string, subject?: string): Promise<void>;
}

export const NOTIFICATION_PROVIDER = Symbol('NOTIFICATION_PROVIDER');
