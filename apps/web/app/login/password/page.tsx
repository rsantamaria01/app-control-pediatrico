'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

export default function PasswordLoginPage() {
  const router = useRouter();
  const { setTokens } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const tokens = await api.auth.password(email, password);
      setTokens(tokens);
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-slate-200 p-8 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Password sign-in</h1>
          <p className="text-sm text-slate-500 mt-1">
            Use your email and password as a fallback.
          </p>
        </header>

        {error && (
          <div className="rounded bg-red-50 text-red-800 text-sm px-3 py-2">{error}</div>
        )}

        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm">
            <span className="text-slate-700">Email</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded border-slate-300 shadow-sm px-3 py-2 border"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-700">Password</span>
            <input
              required
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded border-slate-300 shadow-sm px-3 py-2 border"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded bg-slate-900 text-white py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <footer className="pt-4 border-t border-slate-100 text-sm text-slate-500">
          <Link href="/login" className="hover:text-slate-700 underline">
            Use one-time code instead
          </Link>
        </footer>
      </div>
    </main>
  );
}
