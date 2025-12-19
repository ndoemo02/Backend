// api/admin/amber-export.js
import { supabase } from "../_supabase.js";

function toCsvValue(v) {
  if (v == null) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).send('method_not_allowed');
    // verify middleware already attached for /api/admin/*

    const { data, error } = await supabase.from('amber_intents').select('*').order('created_at', { ascending: false });
    if (error) return res.status(500).send('error: ' + error.message);

    const rows = Array.isArray(data) ? data : [];
    const header = ['timestamp','intent','confidence','fallback','nlu_ms','db_ms','tts_ms','duration_ms','reply_snippet'];
    const lines = [header.join(',')];
    for (const r of rows) {
      const line = [
        toCsvValue(r.created_at || r.timestamp || ''),
        toCsvValue(r.intent),
        toCsvValue(r.confidence ?? ''),
        toCsvValue((r.fallback ?? false) ? 1 : 0),
        toCsvValue(r.nlu_ms ?? r.nluMs ?? ''),
        toCsvValue(r.db_ms ?? r.dbMs ?? ''),
        toCsvValue(r.tts_ms ?? r.ttsMs ?? ''),
        toCsvValue(r.duration_ms ?? r.durationMs ?? ''),
        toCsvValue(r.reply_snippet ?? r.replySnippet ?? ''),
      ];
      lines.push(line.join(','));
    }

    const csv = lines.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=amber_intents.csv');
    return res.status(200).send(csv);
  } catch (e) {
    return res.status(500).send('error: ' + e.message);
  }
}


