import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase-server';
import { consumeRateLimit, getClientIp, type RateLimit } from '../../../lib/rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 5 submissions per IP per hour.
 *
 * Counted in Postgres rather than in memory, so the limit survives a restart
 * or redeploy and applies across every running instance — otherwise the
 * waitlist fills with junk leads the team has to sift through.
 */
const WAITLIST_LIMIT: RateLimit = {
  scope: 'waitlist',
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
};

/** This route touches the database, so it must not be statically optimised. */
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const { allowed } = await consumeRateLimit(WAITLIST_LIMIT, ip);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 },
    );
  }

  let name: string;
  let email: string;
  try {
    const body = await req.json();
    name = (body?.name ?? '').trim();
    email = (body?.email ?? '').trim().toLowerCase();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: 'Please enter a valid email address.' },
      { status: 422 },
    );
  }

  const supabase = getSupabaseServer();
  if (!supabase) {
    // Supabase not configured — log server-side and fail gracefully
    console.warn('[waitlist] Supabase service role key is not configured.');
    return NextResponse.json(
      { error: 'Waitlist service is not configured yet. Please try again shortly.' },
      { status: 503 },
    );
  }

  const { error } = await supabase
    .from('waitlist')
    .insert(name ? { name, email } : { email });

  if (error) {
    // Postgres unique-violation code
    if (error.code === '23505') {
      return NextResponse.json(
        { error: "You're already on the list — we'll be in touch!" },
        { status: 409 },
      );
    }
    const supabaseError = [error.message, error.details].filter(Boolean).join(' — ');
    console.error('[waitlist] insert error:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json(
      { error: supabaseError },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
