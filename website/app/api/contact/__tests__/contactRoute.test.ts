import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getSupabaseServer } = vi.hoisted(() => ({ getSupabaseServer: vi.fn() }));
vi.mock('../../../../lib/supabase-server', () => ({ getSupabaseServer }));

import { POST } from '../route';

function contactRequest(): NextRequest {
  return new NextRequest('https://tradiqs.example/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Ada Trader',
      email: 'ada@example.com',
      message: 'Please tell me more about partnerships.',
    }),
  });
}

function stubInsert(error: { message: string; details?: string; hint?: string } | null) {
  const insert = vi.fn(async () => ({ error }));
  getSupabaseServer.mockReturnValue({ from: vi.fn(() => ({ insert })) });
}

beforeEach(() => {
  getSupabaseServer.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('contact endpoint', () => {
  it('returns Supabase message and details when an insert fails', async () => {
    stubInsert({
      message: "Could not find the table 'public.contact_messages'",
      details: 'The table is missing from the schema cache.',
    });

    const response = await POST(contactRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Could not find the table 'public.contact_messages' — The table is missing from the schema cache.",
    });
  });
});