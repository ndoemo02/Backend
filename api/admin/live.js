// api/admin/live.js
import { supabase } from "../_supabase.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'] || req.query.token;
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const limit = Math.min(parseInt(req.query.limit || '10', 10), 100);
    const { data, error } = await supabase
      .from('amber_intents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const list = (data || []).map(r => ({
      timestamp: r.created_at || r.timestamp,
      intent: r.intent,
      confidence: r.confidence ?? null,
      durationMs: typeof r.duration_ms === 'number' ? r.duration_ms : r.durationMs,
      replySnippet: r.replySnippet || String(r.reply || '').slice(0, 120)
    }));

    return res.status(200).json({ ok: true, data: list });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, data: [] });
  }
}


