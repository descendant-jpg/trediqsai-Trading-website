/**
 * Contract tests for the public waitlist endpoint.
 *
 * These check the wiring rather than the counting: that a limited visitor is
 * turned away before anything is written, that the limit is per-IP, and that
 * an ordinary signup still works.
 */
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const limiter = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, count: 1 })),
  getClientIp: vi.fn(() => '203.0.113.7'),
}));
vi.mock('../../../../lib/rate-limit', () => limiter);

const { getSupabaseServer } = vi.hoisted(() => ({ getSupabaseServer: vi.fn() }));
vi.mock('../../../../lib/supabase-server', () => ({ getSupabaseServer }));

import { POST } from '../route';

/** Stub the Supabase insert used by the route. */
function stubInsert(result: {
  error?: { code?: string; message: string; details?: string; hint?: string } | null;
}) {
  const insert = vi.fn(async () => ({ error: result.error ?? null }));
  const from = vi.fn(() => ({ insert }));
  getSupabaseServer.mockReturnValue({ from });
  return { from, insert };
}

function signupRequest(email: unknown, name?: string): NextRequest {
  const body: Record<string, unknown> = { email };
  if (name !== undefined) body.name = name;
  return new NextRequest('https://tradiqs.example/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  limiter.consumeRateLimit.mockResolvedValue({ allowed: true, count: 1 });
  getSupabaseServer.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('public waitlist endpoint', () => {
  it('accepts a genuine signup with email only', async () => {
    const { from, insert } = stubInsert({});

    const res = await POST(signupRequest('Someone@Example.com'));

    expect(res.status).toBe(201);
    expect(from).toHaveBeenCalledWith('waitlist');
    // Stored normalised, so casing does not create duplicate leads.
    expect(insert).toHaveBeenCalledWith({ email: 'someone@example.com' });
  });

  it('accepts a signup that includes a name alongside the email', async () => {
    const { insert } = stubInsert({});

    const res = await POST(signupRequest('trader@example.com', 'Alice'));

    expect(res.status).toBe(201);
    // Name must be stored alongside the email when provided.
    expect(insert).toHaveBeenCalledWith({ name: 'Alice', email: 'trader@example.com' });
  });

  it('omits the name field when the caller sends an empty name', async () => {
    const { insert } = stubInsert({});

    // An empty string name should be treated as absent — no name key in the insert.
    const res = await POST(signupRequest('trader@example.com', ''));

    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith({ email: 'trader@example.com' });
  });

  it('trims whitespace from the name before storing', async () => {
    const { insert } = stubInsert({});

    await POST(signupRequest('trader@example.com', '  Bob  '));

    const insertArg = (insert as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertArg.name).toBe('Bob');
  });

  it('counts the signup against the limit for that visitor', async () => {
    stubInsert({});

    await POST(signupRequest('someone@example.com'));

    expect(limiter.consumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'waitlist', max: 5 }),
      '203.0.113.7',
    );
  });

  it('turns away a visitor who has used up their allowance', async () => {
    limiter.consumeRateLimit.mockResolvedValue({ allowed: false, count: 6 });
    const { insert } = stubInsert({});

    const res = await POST(signupRequest('spam@example.com'));

    expect(res.status).toBe(429);
    // Nothing must reach the waitlist table.
    expect(insert).not.toHaveBeenCalled();
  });

  it('checks the limit before doing any work', async () => {
    limiter.consumeRateLimit.mockResolvedValue({ allowed: false, count: 6 });
    getSupabaseServer.mockReturnValue(null);

    const res = await POST(signupRequest('not-an-email'));

    // The limit wins over validation, so a spammer cannot probe the endpoint.
    expect(res.status).toBe(429);
  });

  it('rejects an invalid email address', async () => {
    stubInsert({});
    expect((await POST(signupRequest('not-an-email'))).status).toBe(422);
    expect((await POST(signupRequest(''))).status).toBe(422);
  });

  it('rejects a body that is not valid JSON', async () => {
    const req = new NextRequest('https://tradiqs.example/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });

    expect((await POST(req)).status).toBe(400);
  });

  it('tells a repeat visitor they are already on the list', async () => {
    stubInsert({ error: { code: '23505', message: 'duplicate key' } });

    const res = await POST(signupRequest('someone@example.com'));

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "You're already on the list — we'll be in touch!",
    });
  });

  it('fails gracefully when Supabase is not configured', async () => {
    getSupabaseServer.mockReturnValue(null);

    const res = await POST(signupRequest('someone@example.com'));

    expect(res.status).toBe(503);
  });

  it('returns the Supabase error message and details when the insert fails', async () => {
    stubInsert({
      error: {
        message: "Could not find the table 'public.waitlist'",
        details: 'The table is missing from the schema cache.',
      },
    });

    const res = await POST(signupRequest('someone@example.com'));

    // A visitor who sees "you're on the list" but was never saved is the worst
    // outcome here.
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({
      error: "Could not find the table 'public.waitlist' — The table is missing from the schema cache.",
    });
  });
});
