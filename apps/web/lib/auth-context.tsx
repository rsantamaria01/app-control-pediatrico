'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { AuthTokensDto, AuthUserDto } from '@app/shared';
import { api } from './api';

interface AuthState {
  tokens: AuthTokensDto | null;
  user: AuthUserDto | null;
  setTokens: (t: AuthTokensDto) => void;
  logout: () => void;
  ready: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

const STORAGE_KEY = 'pg.auth.v1';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [tokens, setTokensState] = useState<AuthTokensDto | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setTokensState(JSON.parse(raw) as AuthTokensDto);
      }
    } catch {
      // ignore
    }
    setReady(true);
  }, []);

  const setTokens = useCallback((t: AuthTokensDto) => {
    setTokensState(t);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    } catch {
      // ignore
    }
  }, []);

  const logout = useCallback(() => {
    const refresh = tokens?.refreshToken;
    setTokensState(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    if (refresh) {
      void api.auth.logout(refresh).catch(() => undefined);
    }
  }, [tokens?.refreshToken]);

  const value = useMemo<AuthState>(
    () => ({
      tokens,
      user: tokens?.user ?? null,
      setTokens,
      logout,
      ready,
    }),
    [tokens, setTokens, logout, ready],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
