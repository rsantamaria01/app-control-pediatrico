import { NotificationChannel } from '@app/shared';
import { isChannelConfigured } from './active-channels';

describe('isChannelConfigured', () => {
  it('enables EMAIL only when SMTP_HOST is set', () => {
    expect(isChannelConfigured(NotificationChannel.EMAIL, {})).toBe(false);
    expect(isChannelConfigured(NotificationChannel.EMAIL, { SMTP_HOST: 'smtp.example.com' })).toBe(
      true,
    );
  });

  it('enables SMS only when all three Twilio vars are set', () => {
    expect(isChannelConfigured(NotificationChannel.SMS, {})).toBe(false);
    expect(
      isChannelConfigured(NotificationChannel.SMS, {
        TWILIO_ACCOUNT_SID: 'a',
        TWILIO_AUTH_TOKEN: 'b',
      }),
    ).toBe(false);
    expect(
      isChannelConfigured(NotificationChannel.SMS, {
        TWILIO_ACCOUNT_SID: 'a',
        TWILIO_AUTH_TOKEN: 'b',
        TWILIO_FROM: '+1...',
      }),
    ).toBe(true);
  });

  it('enables WHATSAPP only when WHATSAPP_API_KEY is set', () => {
    expect(isChannelConfigured(NotificationChannel.WHATSAPP, {})).toBe(false);
    expect(isChannelConfigured(NotificationChannel.WHATSAPP, { WHATSAPP_API_KEY: 'k' })).toBe(true);
  });

  it('enables TELEGRAM only when TELEGRAM_BOT_TOKEN is set', () => {
    expect(isChannelConfigured(NotificationChannel.TELEGRAM, {})).toBe(false);
    expect(isChannelConfigured(NotificationChannel.TELEGRAM, { TELEGRAM_BOT_TOKEN: 't' })).toBe(
      true,
    );
  });
});
