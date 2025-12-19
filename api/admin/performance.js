import { supabase } from "../_supabase.js";
import { pushLog } from "../utils/logger.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    let rows = [];
    try {
      const { data, error } = await supabase
        .from('amber_intents')
        .select('duration_ms, tts_ms, nlu_ms, db_ms, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (!error && Array.isArray(data)) rows = data;
    } catch {}

    const mapNum = (v) => (typeof v === 'number' ? v : (v ? Number(v) : 0));
    const avg = (arr) => (arr.length ? arr.reduce((a,b)=>a+mapNum(b),0)/arr.length : 0);
    const lastHour = rows.filter(r => Date.now() - new Date(r.created_at).getTime() < 3600000);
    const payload = {
      avgLatencyMs: Math.round(avg(rows.map(r => r.duration_ms ?? r.durationMs ?? 0))),
      ttsAvgMs: Math.round(avg(rows.map(r => r.tts_ms ?? r.ttsMs ?? 0))),
      nluAvgMs: Math.round(avg(rows.map(r => r.nlu_ms ?? r.nluMs ?? 0))),
      dbAvgMs: Math.round(avg(rows.map(r => r.db_ms ?? r.dbMs ?? 0))),
      lastHourRequests: lastHour.length,
      timestamp: new Date().toISOString()
    };
    console.log('[ADMIN] /api/admin/performance', payload);
    pushLog('admin', 'performance queried');
    return res.status(200).json({ ok: true, ...payload });
  } catch (e) {
    console.error('[ADMIN] performance error:', e.message);
    pushLog('error', `performance: ${e.message}`);
    return res.status(200).json({ ok: true, avgLatencyMs: 0, ttsAvgMs: 0, nluAvgMs: 0, dbAvgMs: 0, lastHourRequests: 0 });
  }
}


