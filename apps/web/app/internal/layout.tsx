'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { UserRole } from '@app/shared';
import { useAuth } from '@/lib/auth-context';

export default function InternalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, ready, logout } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace('/login');
    } else if (user.role !== UserRole.ADMIN && user.role !== UserRole.DOCTOR) {
      router.replace('/external/dashboard');
    }
  }, [user, ready, router]);

  if (!ready || !user) {
    return null;
  }

  const NavLink = ({ href, label }: { href: string; label: string }) => {
    const active = pathname === href || pathname.startsWith(`${href}/`);
    return (
      <Link
        href={href}
        className={`px-3 py-1.5 rounded text-sm ${
          active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-6">
          <div className="font-semibold tracking-tight">Pediatric Growth · Clinic</div>
          <nav className="flex items-center gap-1">
            <NavLink href="/internal/dashboard" label="Dashboard" />
            <NavLink href="/internal/patients" label="Patients" />
            <NavLink href="/internal/parents" label="Parents" />
            {user.role === UserRole.ADMIN && (
              <NavLink href="/internal/users" label="Users" />
            )}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span>{user.email ?? user.phone}</span>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs uppercase">
              {user.role}
            </span>
            <button
              onClick={logout}
              className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
