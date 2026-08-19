import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const limiter = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(async () => ({ allowed: true, count: 1 })),
  getClientIp: vi.fn(() => '203.0.113.9'),
}));
vi.mock('../../../../lib/rate-limit', () => limiter);

const { getSupabaseServer } = vi.hoisted(() => ({ getSupabaseServer: vi.fn() }));
vi.mock('../../../../lib/supabase-server', () => ({ getSupabaseServer }));

import { POST } from '../route';

function requestFor(body: unknown): NextRequest {
  return new NextRequest('https://tradiqs.example/api/contact', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': '203.0.113.9',
    },
    body: JSON.stringify(body),
  });
}

function stubInsert(error: { message: string; details?: string; hint?: string } | null) {
  const insert = vi.fn(async () => ({ error }));
  getSupabaseServer.mockReturnValue({ from: vi.fn(() => ({ insert })) });
  return insert;
}

beforeEach(() => {
  limiter.consumeRateLimit.mockResolvedValue({ allowed: true, count: 1 });
  stubInsert(null);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('public contact endpoint', () => {
  it('uses the durable per-IP limiter before inserting', async () => {
    const response = await POST(
      requestFor({ name: 'Alice', email: 'alice@example.com', message: 'Hello team.' }),
    );

    expect(response.status).toBe(200);
    expect(limiter.getClientIp).toHaveBeenCalled();
    expect(limiter.consumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'contact', max: 5, windowMs: 3_600_000 }),
      '203.0.113.9',
    );
  });

  it('rejects overlong fields before touching Supabase', async () => {
    const insert = stubInsert(null);

    const response = await POST(
      requestFor({
        name: 'A'.repeat(101),
        email: 'alice@example.com',
        message: 'Hello team.',
      }),
    );

    expect(response.status).toBe(422);
    expect(insert).not.toHaveBeenCalled();
  });

  it('does not expose database details when an insert fails', async () => {
    stubInsert({
      message: "Could not find the table 'public.contact_messages'",
      details: 'The table is missing from the schema cache.',
    });

    const response = await POST(
      requestFor({ name: 'Alice', email: 'alice@example.com', message: 'Hello team.' }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Unable to send your message right now.' });
  });

  it('rejects requests when the durable limit is exhausted', async () => {
    limiter.consumeRateLimit.mockResolvedValue({ allowed: false, count: 6 });
    const insert = stubInsert(null);

    const response = await POST(
      requestFor({ name: 'Alice', email: 'alice@example.com', message: 'Hello team.' }),
    );

    expect(response.status).toBe(429);
    expect(insert).not.toHaveBeenCalled();
  });
});