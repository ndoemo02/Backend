// api/admin/trends-analyze.js
import { supabase } from "../_supabase.js";

async function avgNumber(rows, keyA, keyB) {
  if (!Array.isArray(rows)) return 0;
  const nums = rows
    .map(r => (typeof r[keyA] === 'number' ? r[keyA] : (typeof r[keyB] === 'number' ? r[keyB] : null)))
    .filter(v => typeof v === 'number' && isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((a,b)=>a+b,0) / nums.length;
}

function pctChange(nowVal, prevVal) {
  if (!prevVal) return nowVal ? 1 : 0;
  return (nowVal - prevVal) / prevVal;
}

async function insertAlert(alert) {
  try {
    const { error } = await supabase.from('amber_alerts').insert({
      created_at: new Date().toISOString(),
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      metric: alert.metric || null,
      delta_pct: alert.deltaPct ?? null,
      value_now: alert.valueNow ?? null,
      value_prev: alert.valuePrev ?? null,
      details: alert.details || null,
    });
    if (error) throw error;
  } catch (e) {
    globalThis.__amber_alerts = globalThis.__amber_alerts || [];
    globalThis.__amber_alerts.push({ time: new Date().toISOString(), ...alert });
    if (globalThis.__amber_alerts.length > 100) globalThis.__amber_alerts.shift();
  }
}

async function postWebhook(text) {
  const url = process.env.SLACK_WEBHOOK_URL || process.env.AMBER_ALERT_WEBHOOK;
  if (!url) return;
  try {
    const fetch = (await import('node-fetch')).default;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  } catch {}
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const days = 7;
    const now = Date.now();
    const lastStart = new Date(now - days*24*3600*1000).toISOString();
    const prevStart = new Date(now - 2*days*24*3600*1000).toISOString();
    const prevEnd = new Date(now - days*24*3600*1000).toISOString();

    // TTS averages
    const { data: lastRows } = await supabase
      .from('amber_intents')
      .select('tts_ms,ttsMs,duration_ms,durationMs,created_at')
      .gte('created_at', lastStart);

    const { data: prevRows } = await supabase
      .from('amber_intents')
      .select('tts_ms,ttsMs,duration_ms,durationMs,created_at')
      .gte('created_at', prevStart)
      .lt('created_at', prevEnd);

    const ttsNow = await avgNumber(lastRows || [], 'tts_ms', 'ttsMs');
    const ttsPrev = await avgNumber(prevRows || [], 'tts_ms', 'ttsMs');
    const ttsDelta = pctChange(ttsNow, ttsPrev);

    const alerts = [];
    if (ttsPrev && ttsDelta > 0.15) {
      const msg = `Ostatnio wzrosła średnia latencja TTS o ${(ttsDelta*100).toFixed(1)}% (z ${Math.round(ttsPrev)} ms do ${Math.round(ttsNow)} ms).`;
      const alert = { type: 'tts_latency', severity: ttsDelta > 0.25 ? 'error' : 'warn', message: msg, metric: 'tts_ms', deltaPct: ttsDelta, valueNow: ttsNow, valuePrev: ttsPrev };
      alerts.push(alert); await insertAlert(alert); await postWebhook(msg);
    }

    // Restaurants activity
    const { data: lastInt } = await supabase.from('amber_intents').select('restaurant_id,created_at').gte('created_at', lastStart);
    const { data: prevInt } = await supabase.from('amber_intents').select('restaurant_id,created_at').gte('created_at', prevStart).lt('created_at', prevEnd);
    const countBy = (rows) => {
      const m = new Map(); (rows||[]).forEach(r => { const id = r.restaurant_id; if (!id) return; m.set(id, (m.get(id)||0)+1); }); return m; };
    const lastMap = countBy(lastInt);
    const prevMap = countBy(prevInt);
    const ids = new Set([...lastMap.keys(), ...prevMap.keys()]);
    const idArr = Array.from(ids).filter(Boolean);
    let nameMap = new Map();
    if (idArr.length) {
      const { data: rests } = await supabase.from('restaurants').select('id,name').in('id', idArr);
      (rests||[]).forEach(r => nameMap.set(r.id, r.name));
    }
    for (const id of idArr) {
      const prev = prevMap.get(id) || 0; const nowCnt = lastMap.get(id) || 0;
      if (prev >= 3) {
        const d = pctChange(nowCnt, prev);
        if (d <= -0.3) {
          const name = nameMap.get(id) || id;
          const msg = `Restauracja ${name} notuje spadek aktywności o ${Math.abs(d*100).toFixed(0)}% (z ${prev} do ${nowCnt}).`;
          const alert = { type: 'restaurant_activity_drop', severity: 'warn', message: msg, metric: 'interactions', deltaPct: d, valueNow: nowCnt, valuePrev: prev, details: { restaurant_id: id } };
          alerts.push(alert); await insertAlert(alert); await postWebhook(msg);
        }
      }
    }

    return res.status(200).json({ ok: true, analyzed: true, alerts, tts: { now: ttsNow, prev: ttsPrev, delta: ttsDelta } });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}


