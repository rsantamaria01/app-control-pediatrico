'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { UserRole } from '@app/shared';

export default function HomePage() {
  const router = useRouter();
  const { user, ready } = useAuth();

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace('/login');
    } else if (user.role === UserRole.PATIENT) {
      router.replace('/external/dashboard');
    } else {
      router.replace('/internal/dashboard');
    }
  }, [user, ready, router]);

  return null;
}
