import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { supabaseAuthStorage } from './secureStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  '';

/** True once EXPO_PUBLIC_SUPABASE_URL and either supported public key are configured. */
export const isSupabaseConfigured = !!supabaseUrl && !!supabasePublishableKey;

let client: SupabaseClient | null = null;

/**
 * Lazily creates the Supabase client on first use. Lazy so that merely
 * importing this module never crashes the app when the EXPO_PUBLIC_
 * env vars aren't set yet — callers get a clear error at call time instead.
 * Native auth sessions persist through Expo SecureStore. The adapter has a
 * browser-only localStorage fallback for Expo web, where a native keychain is
 * unavailable.
 */
function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  if (!client) {
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        storage: supabaseAuthStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    hookAppState(client);
  }
  return client;
}

// Keep the auth session fresh: refresh tokens while the app is in the
// foreground, stop when backgrounded. Guarded so dev fast-refresh doesn't
// stack duplicate listeners.
declare global {
  // eslint-disable-next-line no-var
  var __supabaseAppStateHooked: boolean | undefined;
}

function hookAppState(c: SupabaseClient) {
  if (globalThis.__supabaseAppStateHooked) return;
  globalThis.__supabaseAppStateHooked = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      c.auth.startAutoRefresh();
    } else {
      c.auth.stopAutoRefresh();
    }
  });
}

/**
 * Drop-in `supabase` export: property access is forwarded to the lazily
 * created client, so `supabase.auth...` / `supabase.from(...)` work
 * unchanged everywhere.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    const real = getSupabase();
    const value = Reflect.get(real, prop, real);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});
