'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NotificationChannel } from '@app/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

type Step = 'identifier' | 'code';

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  [NotificationChannel.EMAIL]: 'Email',
  [NotificationChannel.SMS]: 'SMS',
  [NotificationChannel.WHATSAPP]: 'WhatsApp',
  [NotificationChannel.TELEGRAM]: 'Telegram',
};

export default function LoginPage() {
  const router = useRouter();
  const { setTokens } = useAuth();
  const [step, setStep] = useState<Step>('identifier');
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState<NotificationChannel | null>(null);
  const [availableChannels, setAvailableChannels] = useState<NotificationChannel[] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.auth
      .config()
      .then((cfg) => {
        if (cancelled) return;
        setAvailableChannels(cfg.channels);
        if (cfg.channels.length > 0) {
          setChannel(cfg.channels[0]);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableChannels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const requestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channel) return;
    setError(null);
    setBusy(true);
    try {
      await api.auth.requestOtp(identifier, channel);
      setInfo(`Code sent via ${channel.toLowerCase()}.`);
      setStep('code');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tokens = await api.auth.verifyOtp(identifier, code);
      setTokens(tokens);
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const otpDisabled = availableChannels !== null && availableChannels.length === 0;

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Pediatric Growth</h1>
          <p className="text-sm text-slate-500 mt-1">
            {otpDisabled
              ? 'No notification channel is configured on this server. Please sign in with a password.'
              : step === 'identifier'
                ? 'Sign in with a one-time code sent to your email or phone.'
                : `We sent a code to ${identifier}.`}
          </p>
        </header>

        {error && (
          <div className="rounded bg-red-50 text-red-800 text-sm px-3 py-2">{error}</div>
        )}
        {info && (
          <div className="rounded bg-emerald-50 text-emerald-800 text-sm px-3 py-2">{info}</div>
        )}

        {!otpDisabled && step === 'identifier' && availableChannels !== null && (
          <form onSubmit={requestOtp} className="space-y-4">
            <label className="block text-sm">
              <span className="text-slate-700">Email or phone</span>
              <input
                required
                type="text"
                autoComplete="email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="mt-1 block w-full rounded border-slate-300 shadow-sm px-3 py-2 border focus:ring-2 focus:ring-slate-400 outline-none"
              />
            </label>
            <label className="block text-sm">
              <span className="text-slate-700">Channel</span>
              <select
                value={channel ?? ''}
                onChange={(e) => setChannel(e.target.value as NotificationChannel)}
                className="mt-1 block w-full rounded border-slate-300 shadow-sm px-3 py-2 border bg-white"
              >
                {availableChannels.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              disabled={busy || !channel}
              className="w-full rounded bg-slate-900 text-white py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        )}

        {!otpDisabled && step === 'code' && (
          <form onSubmit={verifyOtp} className="space-y-4">
            <label className="block text-sm">
              <span className="text-slate-700">Code</span>
              <input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 block w-full rounded border-slate-300 shadow-sm px-3 py-2 border tracking-widest text-lg text-center"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-slate-900 text-white py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => setStep('identifier')}
              className="w-full rounded text-sm text-slate-500 hover:text-slate-700"
            >
              Use a different identifier
            </button>
          </form>
        )}

        <footer className="pt-4 border-t border-slate-100 text-sm text-slate-500">
          <Link href="/login/password" className="hover:text-slate-700 underline">
            {otpDisabled ? 'Continue to password sign-in' : 'Sign in with password instead'}
          </Link>
        </footer>
      </div>
    </main>
  );
}
