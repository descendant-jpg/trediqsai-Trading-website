import { NextResponse } from 'next/server';
import { getSupabaseServer } from '../../../../../lib/supabase-server';
import { ADMIN_COOKIE, isValidSessionToken } from '../../../../../lib/admin-auth';

type BroadcastRequest = {
  signalId: string;
  asset: string;
  direction: 'BUY' | 'SELL';
  confidenceScore: number;
  isPremium?: boolean;
};

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(
    new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=([^;]*)`),
  );
  return match?.[1];
}

export async function POST(request: Request) {
  try {
    // The Next middleware protects this path in production. Repeat the check
    // here so direct route invocation and future middleware changes cannot turn
    // this high-impact operation into an unauthenticated broadcast endpoint.
    if (!(await isValidSessionToken(readCookie(request, ADMIN_COOKIE)))) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    const body = (await request.json()) as Partial<BroadcastRequest>;
    if (!body.signalId || !body.asset || !body.direction || typeof body.confidenceScore !== 'number') {
      return NextResponse.json({ error: 'Invalid broadcast payload.' }, { status: 400 });
    }
    const supabase = getSupabaseServer();
    if (!supabase) return NextResponse.json({ error: 'Server Supabase is not configured.' }, { status: 503 });

    const isPremium = body.isPremium !== false;
    let profileQuery = supabase
      .from('profiles')
      .select('expo_push_token')
      .not('expo_push_token', 'is', null);
    if (isPremium) {
      profileQuery = profileQuery.in('tier', ['pro', 'elite', 'whale', 'vip']);
    }
    const { data: profiles, error } = await profileQuery;
    if (error) throw error;
    const tokens = (profiles ?? []).map((profile) => profile.expo_push_token).filter((token): token is string => Boolean(token));
    if (!tokens.length) return NextResponse.json({ sent: 0 });

    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({
        to,
        title: isPremium ? '🚨 New Premium Signal' : `🚨 New Signal: ${body.asset} ${body.direction}`,
        body: isPremium
          ? 'A new Premium setup is ready. Tap to view your signal desk.'
          : `AI Conviction: ${body.confidenceScore}%. Tap to view entry levels.`,
        data: { signal_id: body.signalId },
      }))),
    });
    if (!response.ok) throw new Error(`Expo push service returned ${response.status}.`);
    return NextResponse.json({ sent: tokens.length });
  } catch (error) {
    console.error('[admin-signals-broadcast] failed:', error);
    return NextResponse.json({ error: 'Broadcast failed.' }, { status: 500 });
  }
}