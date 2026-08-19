import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  isValidSessionToken: vi.fn(async () => true),
}));
vi.mock('../../../../../../lib/admin-auth', () => ({
  ADMIN_COOKIE: 'tq_admin_session',
  isValidSessionToken: auth.isValidSessionToken,
}));

const { getSupabaseServer } = vi.hoisted(() => ({ getSupabaseServer: vi.fn() }));
vi.mock('../../../../../../lib/supabase-server', () => ({ getSupabaseServer }));

import { POST } from '../route';

const payload = {
  signalId: 'signal-1',
  asset: 'XAUUSD',
  direction: 'BUY' as const,
  confidenceScore: 88,
  isPremium: true,
};

function queryResult(data: Array<{ expo_push_token: string }>) {
  const query = Promise.resolve({ data, error: null }) as Promise<
    { data: Array<{ expo_push_token: string }>; error: null }
  > & {
    select: ReturnType<typeof vi.fn>;
    not: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
  };
  query.select = vi.fn(() => query);
  query.not = vi.fn(() => query);
  query.in = vi.fn(() => query);
  return query;
}

function requestFor(body = payload, cookie = 'admin-session'): NextRequest {
  return new NextRequest('https://tradiqs.example/api/admin/signals/broadcast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { cookie: `tq_admin_session=${cookie}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  auth.isValidSessionToken.mockResolvedValue(true);
  getSupabaseServer.mockReturnValue({
    from: vi.fn(() => queryResult([{ expo_push_token: 'ExponentPushToken[test]' }])),
  });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ data: [] }), { status: 200 }),
  );
});

describe('admin signal broadcast endpoint', () => {
  it('requires a verified admin session even when called directly', async () => {
    auth.isValidSessionToken.mockResolvedValue(false);

    const response = await POST(requestFor());

    expect(response.status).toBe(401);
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });

  it('targets only paid tiers for premium broadcasts', async () => {
    const query = queryResult([{ expo_push_token: 'ExponentPushToken[test]' }]);
    getSupabaseServer.mockReturnValue({ from: vi.fn(() => query) });

    const response = await POST(requestFor());

    expect(response.status).toBe(200);
    expect(query.in).toHaveBeenCalledWith('tier', ['pro', 'elite', 'whale', 'vip']);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://exp.host/--/api/v2/push/send',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('does not expose provider error details to callers', async () => {
    getSupabaseServer.mockReturnValue({
      from: vi.fn(() => Promise.resolve({ data: null, error: new Error('private database detail') })),
    });
    const response = await POST(requestFor());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Broadcast failed.' });
  });
});