// api/admin/intents-export.js
import { supabase } from "../_supabase.js";

function forbid(res) { return res.status(403).send('forbidden'); }

function csvEscape(val) {
  if (val == null) return '';
  const s = String(val).replace(/"/g, '""');
  if (/[",\n]/.test(s)) return '"' + s + '"';
  return s;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).send('method_not_allowed');
    const token = req.headers['x-admin-token'] || req.query.token;
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const limit = Math.min(parseInt(req.query.limit || '5000', 10), 20000);
    const daysBack = parseInt(req.query.days || '30', 10);
    const sinceIso = new Date(Date.now() - daysBack * 24 * 3600 * 1000).toISOString();

    const { data, error } = await supabase
      .from('amber_intents')
      .select('*')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;

    const headers = ['timestamp','intent','confidence','fallback','durationMs','nluMs','dbMs','ttsMs','restaurant_id','replySnippet'];
    const lines = [headers.join(',')];
    (data || []).forEach(r => {
      const ts = r.created_at || r.timestamp;
      const row = [
        csvEscape(ts),
        csvEscape(r.intent),
        csvEscape(typeof r.confidence === 'number' ? r.confidence.toFixed(2) : r.confidence),
        csvEscape(r.fallback ? 1 : 0),
        csvEscape(typeof r.duration_ms === 'number' ? r.duration_ms : r.durationMs),
        csvEscape(typeof r.nlu_ms === 'number' ? r.nlu_ms : r.nluMs),
        csvEscape(typeof r.db_ms === 'number' ? r.db_ms : r.dbMs),
        csvEscape(typeof r.tts_ms === 'number' ? r.tts_ms : r.ttsMs),
        csvEscape(r.restaurant_id),
        csvEscape(String(r.reply || '').slice(0, 160))
      ];
      lines.push(row.join(','));
    });

    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="amber_intents_${new Date().toISOString().slice(0,10)}.csv"`);
    return res.status(200).send(csv);
  } catch (e) {
    return res.status(500).send('error: ' + e.message);
  }
}


