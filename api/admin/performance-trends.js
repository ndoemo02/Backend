// api/admin/performance-trends.js
import { supabase } from "../_supabase.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

function avg(arr) {
  const nums = (arr || []).filter(x => typeof x === 'number' && isFinite(x));
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a,b)=>a+b,0) / nums.length);
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'] || req.query.token;
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const daysBack = parseInt(req.query.days || '7', 10);
    const from = req.query.from;
    const to = req.query.to;
    const intent = req.query.intent;

    let query = supabase
      .from('amber_intents')
      .select('*');
    if (from) query = query.gte('created_at', from); else query = query.gte('created_at', new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString());
    if (to) query = query.lte('created_at', to);
    if (intent) query = query.eq('intent', intent);

    const { data, error } = await query;
    if (error) throw error;

    const days = {};
    (data || []).forEach(r => {
      const created = r.created_at || r.timestamp || new Date().toISOString();
      const day = String(created).split('T')[0];
      if (!days[day]) days[day] = { nlu: [], db: [], tts: [], dur: [] };
      const nlu = typeof r.nlu_ms === 'number' ? r.nlu_ms : r.nluMs;
      const db = typeof r.db_ms === 'number' ? r.db_ms : r.dbMs;
      const tts = typeof r.tts_ms === 'number' ? r.tts_ms : r.ttsMs;
      const dur = typeof r.duration_ms === 'number' ? r.duration_ms : r.durationMs;
      if (typeof nlu === 'number') days[day].nlu.push(nlu);
      if (typeof db === 'number') days[day].db.push(db);
      if (typeof tts === 'number') days[day].tts.push(tts);
      if (typeof dur === 'number') days[day].dur.push(dur);
    });

    const result = Object.entries(days)
      .sort((a,b)=> a[0] < b[0] ? -1 : 1)
      .map(([d, v]) => ({ day: d, nluAvg: avg(v.nlu), dbAvg: avg(v.db), ttsAvg: avg(v.tts), durAvg: avg(v.dur) }));

    return res.status(200).json({ ok: true, data: result, days: daysBack, timestamp: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, data: [] });
  }
}


