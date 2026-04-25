import { NotificationChannel } from '@app/shared';
import { NotificationService } from './notification.service';
import { NotificationProvider } from './notification-provider.interface';

function fakeProvider(channel: NotificationChannel): NotificationProvider & {
  calls: Array<{ to: string; message: string; subject?: string }>;
} {
  const calls: Array<{ to: string; message: string; subject?: string }> = [];
  return {
    channel,
    calls,
    async send(to: string, message: string, subject?: string): Promise<void> {
      calls.push({ to, message, subject });
    },
  };
}

describe('NotificationService', () => {
  it('reports the configured channels', () => {
    const email = fakeProvider(NotificationChannel.EMAIL);
    const sms = fakeProvider(NotificationChannel.SMS);
    const svc = new NotificationService([email, sms]);
    expect(svc.channels().sort()).toEqual(
      [NotificationChannel.EMAIL, NotificationChannel.SMS].sort(),
    );
    expect(svc.hasChannel(NotificationChannel.EMAIL)).toBe(true);
    expect(svc.hasChannel(NotificationChannel.WHATSAPP)).toBe(false);
  });

  it('dispatches to the matching provider', async () => {
    const email = fakeProvider(NotificationChannel.EMAIL);
    const svc = new NotificationService([email]);
    await svc.dispatch(NotificationChannel.EMAIL, 'a@b.c', 'hello', 'subj');
    expect(email.calls).toEqual([{ to: 'a@b.c', message: 'hello', subject: 'subj' }]);
  });

  it('throws when dispatching to a channel that is not active', async () => {
    const svc = new NotificationService([]);
    await expect(svc.dispatch(NotificationChannel.EMAIL, 'x', 'y')).rejects.toThrow(
      /not active/i,
    );
  });

  it('reports an empty channel list when nothing is configured', () => {
    const svc = new NotificationService([]);
    expect(svc.channels()).toEqual([]);
    expect(svc.hasChannel(NotificationChannel.EMAIL)).toBe(false);
  });
});
