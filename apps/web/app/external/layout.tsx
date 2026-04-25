'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserRole } from '@app/shared';
import { useAuth } from '@/lib/auth-context';

export default function ExternalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, ready, logout } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace('/login');
    } else if (user.role !== UserRole.PATIENT) {
      router.replace('/internal/dashboard');
    }
  }, [user, ready, router]);

  if (!ready || !user) return null;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link href="/external/dashboard" className="font-semibold tracking-tight">
            Pediatric Growth · Family
          </Link>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span>{user.email ?? user.phone}</span>
            <button
              onClick={logout}
              className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
