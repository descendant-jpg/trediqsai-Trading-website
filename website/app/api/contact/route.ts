import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../lib/supabase-server';
import { consumeRateLimit, getClientIp } from '../../../lib/rate-limit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 255;
const MAX_MESSAGE_LENGTH = 2_000;
const CONTACT_RATE_LIMIT = {
  scope: 'contact',
  windowMs: 60 * 60 * 1_000,
  max: 5,
} as const;

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const rate = await consumeRateLimit(CONTACT_RATE_LIMIT, getClientIp(request));
    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many contact requests. Please try again later.' },
        { status: 429 },
      );
    }

    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const message = typeof body?.message === 'string' ? body.message.trim() : '';

    if (
      !name ||
      !email ||
      !message ||
      !EMAIL_RE.test(email) ||
      name.length > MAX_NAME_LENGTH ||
      email.length > MAX_EMAIL_LENGTH ||
      message.length > MAX_MESSAGE_LENGTH
    ) {
      return NextResponse.json(
        {
          error:
            'Please provide a valid name, email address, and message within the allowed lengths.',
        },
        { status: 422 },
      );
    }

    const supabase = getSupabaseServer();
    if (!supabase) {
      console.warn('[contact] Supabase service role key is not configured.');
      return NextResponse.json({ error: 'Unable to send your message right now.' }, { status: 503 });
    }

    const { error } = await supabase
      .from('contact_messages')
      .insert({ name, email, message });

    if (error) {
      console.error('[contact] insert error:', error.message);
      return NextResponse.json({ error: 'Unable to send your message right now.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, message: 'Message received. Our team will be in touch.' });
  } catch (error) {
    console.error('[contact] request error:', error);
    return NextResponse.json({ error: 'Unable to send your message right now.' }, { status: 400 });
  }
}