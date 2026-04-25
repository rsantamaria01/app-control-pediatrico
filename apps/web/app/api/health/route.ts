import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STARTED_AT = Date.now();

interface HealthDto {
  status: 'ok' | 'degraded';
  uptimeSec: number;
  api: { ok: boolean; status?: number; latencyMs?: number; error?: string };
}

/**
 * Liveness probe for Uptime Kuma / docker healthchecks. Reports the
 * Next.js process as live and additionally pings the upstream API
 * health endpoint so the web check fails when its API dependency is
 * unreachable. 200 OK when both the web process and the API are up,
 * 503 otherwise.
 */
export async function GET(): Promise<NextResponse<HealthDto>> {
  // INTERNAL_API_URL is the in-cluster URL used for server-to-server
  // calls (the "api" docker service). Falls back to the browser-facing
  // URL when not set so local-dev outside compose still works.
  const apiUrl =
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    'http://localhost:3001';
  const start = Date.now();
  let api: HealthDto['api'];
  try {
    const res = await fetch(`${apiUrl}/api/v1/health`, {
      signal: AbortSignal.timeout(2000),
      cache: 'no-store',
    });
    api = { ok: res.ok, status: res.status, latencyMs: Date.now() - start };
  } catch (err) {
    api = { ok: false, latencyMs: Date.now() - start, error: (err as Error).message };
  }
  const status: HealthDto['status'] = api.ok ? 'ok' : 'degraded';
  return NextResponse.json(
    {
      status,
      uptimeSec: Math.floor((Date.now() - STARTED_AT) / 1000),
      api,
    },
    { status: api.ok ? 200 : 503 },
  );
}
