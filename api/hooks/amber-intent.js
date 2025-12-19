// api/hooks/amber-intent.js
import { supabase } from "../_supabase.js";

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-amber-token'] || req.headers['x-admin-token'] || req.query.token || req.query.admin_token;
    if (!token || token !== process.env.ADMIN_TOKEN) return res.status(403).json({ ok: false, error: 'forbidden' });

    const body = req.body || {};
    const intent = body.intent || 'unknown';
    const confidence = typeof body.confidence === 'number' ? body.confidence : 0;
    const fallback = typeof body.fallback === 'boolean' ? body.fallback : (intent === 'none');
    const replySnippet = String(body.reply_snippet || body.replySnippet || '').slice(0, 160);
    const nlu = Number(body.nlu_ms ?? body.nluMs ?? 0);
    const db = Number(body.db_ms ?? body.dbMs ?? 0);
    const tts = Number(body.tts_ms ?? body.ttsMs ?? 0);
    const dur = Number(body.duration_ms ?? body.durationMs ?? (nlu + db + tts));

    // try snake_case insert first, fallback to camelCase
    try {
      await supabase.from('amber_intents').insert({
        intent,
        confidence,
        fallback,
        reply_snippet: replySnippet,
        nlu_ms: nlu,
        db_ms: db,
        tts_ms: tts,
        duration_ms: dur,
        created_at: new Date().toISOString(),
      });
    } catch (e1) {
      try {
        await supabase.from('amber_intents').insert({
          timestamp: new Date().toISOString(),
          intent,
          confidence,
          fallback,
          replySnippet,
          nluMs: nlu,
          dbMs: db,
          ttsMs: tts,
          durationMs: dur,
        });
      } catch (e2) {
        return res.status(500).json({ ok: false, error: e2.message });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}


