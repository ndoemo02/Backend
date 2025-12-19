import { supabase } from "../_supabase.js";
import { pushLog } from "../utils/logger.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const { from, to, intent } = req.query || {};
    const limit = Math.min(parseInt(req.query.limit || '500', 10), 2000);

    // Spróbuj pobrać z tabeli amber_intents (jeśli istnieje)
    let list = [];
    try {
      let query = supabase
        .from('amber_intents')
        .select('created_at,intent,confidence,fallback,duration_ms,reply,tts_ms,nlu_ms,db_ms,restaurant_id')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (from) query = query.gte('created_at', from);
      if (to) query = query.lte('created_at', to);
      if (intent) query = query.eq('intent', intent);

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        list = data.map(r => ({
          timestamp: r.created_at,
          intent: r.intent,
          confidence: typeof r.confidence === 'number' ? r.confidence : null,
          fallback: !!r.fallback,
          durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : (r.durationMs ?? null),
          replySnippet: (r.reply || '').slice(0, 120),
          ttsMs: r.tts_ms ?? r.ttsMs ?? null,
          nluMs: r.nlu_ms ?? r.nluMs ?? null,
          dbMs: r.db_ms ?? r.dbMs ?? null,
          restaurant_id: r.restaurant_id || null
        }));
      }
    } catch {}

    const data = { data: list, count: list.length, timestamp: new Date().toISOString() };
    console.log('[ADMIN] /api/admin/intents', { returned: data.count });
    pushLog('admin', `intents fetched: ${data.count}`);
    return res.status(200).json({ ok: true, ...data });
  } catch (e) {
    console.error('[ADMIN] intents error:', e.message);
    pushLog('error', `intents: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message, data: [] });
  }
}


