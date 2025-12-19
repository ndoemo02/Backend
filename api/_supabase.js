// api/_supabase.js
import { createClient } from '@supabase/supabase-js';

// Funkcja do tworzenia klienta Supabase z lazy loading
function createSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.error('[Supabase] Missing envs: SUPABASE_URL and/or SUPABASE_*_KEY');
    console.error('[Supabase] SUPABASE_URL:', url ? '✅ loaded' : '❌ missing');
    console.error('[Supabase] SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ loaded' : '❌ missing');
    console.error('[Supabase] SUPABASE_SERVICE_ROLE:', process.env.SUPABASE_SERVICE_ROLE ? '✅ loaded' : '❌ missing');
    console.error('[Supabase] SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? '✅ loaded' : '❌ missing');
    return null;
  }

  console.log('[Supabase] Creating client with URL:', url);
  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

// Lazy loading - klient jest tworzony przy pierwszym użyciu
let _supabaseClient = null;

function getSupabaseClient() {
  if (!_supabaseClient) {
    _supabaseClient = createSupabaseClient();
  }
  return _supabaseClient;
}

// Proxy object który przekierowuje wszystkie wywołania do klienta
export const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getSupabaseClient();
    if (!client) {
      throw new Error('Supabase client not initialized');
    }
    return client[prop];
  }
});
