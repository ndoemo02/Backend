import fs from 'fs';
import path from 'path';
import { pushLog } from "../utils/logger.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'PATCH') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const url = new URL(req.url, 'http://localhost');
    const profile = url.searchParams.get('profile') || 'balanced';
    const allowed = ['speed','balanced','quality'];
    const mode = allowed.includes(profile) ? profile : 'balanced';

    process.env.TTS_PROFILE = mode;
    let persisted = false;
    try {
      // Spróbuj nadpisać/utworzyć .env.vercel (jeśli istnieje repo Vercel)
      const envPath = path.join(process.cwd(), '.env.vercel');
      let content = '';
      try { content = fs.readFileSync(envPath, 'utf8'); } catch { content = ''; }
      if (content.includes('TTS_PROFILE=')) {
        content = content.replace(/TTS_PROFILE=.*/g, `TTS_PROFILE=${mode}`);
      } else {
        content += `${content.endsWith('\n') ? '' : '\n'}TTS_PROFILE=${mode}\n`;
      }
      fs.writeFileSync(envPath, content, 'utf8');
      persisted = true;
    } catch {}

    console.log(`[ADMIN] TTS profile set to ${mode}${persisted ? ' (persisted)' : ''}`);
    pushLog('admin', `tts profile -> ${mode}`);
    return res.status(200).json({ ok: true, mode, persisted });
  } catch (e) {
    console.error('[ADMIN] tts error:', e.message);
    pushLog('error', `tts: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


