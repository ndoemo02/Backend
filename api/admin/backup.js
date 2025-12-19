import fs from 'fs';
import path from 'path';
import { supabase } from "../_supabase.js";
import { pushLog } from "../utils/logger.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
    const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'];
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const ts = new Date().toISOString();
    const outDir = path.join(process.cwd(), 'backups');

    const tables = ['restaurants', 'menu_items_v2'];
    let tablesExported = 0;
    const payload = {};

    for (const t of tables) {
      const { data, error } = await supabase.from(t).select('*');
      if (error) throw error;
      payload[t] = { count: data?.length || 0, timestamp: ts, rows: data || [] };
      tablesExported++;
    }
    // local_promotions (opcjonalnie)
    try {
      const { data, error } = await supabase.from('local_promotions').select('*');
      if (!error && data) {
        payload['local_promotions'] = { count: data.length, timestamp: ts, rows: data };
        tablesExported++;
      }
    } catch {}

    // Spróbuj zapisu do plików; jeśli się nie uda → zwróć JSON
    try {
      fs.mkdirSync(outDir, { recursive: true });
      for (const key of Object.keys(payload)) {
        const file = path.join(outDir, `${key}.json`);
        fs.writeFileSync(file, JSON.stringify(payload[key], null, 2), 'utf8');
      }
      console.log(`[BACKUP] Export done: {tables:${tablesExported}, rows:${Object.values(payload).reduce((s, x) => s + (x.count || 0), 0)}}`);
      pushLog('admin', `backup written to files (${tablesExported} tables)`);
      return res.status(200).json({ ok: true, files: true, tables: tablesExported, timestamp: ts });
    } catch (e) {
      console.warn('[BACKUP] Write access denied, returning JSON payload');
      pushLog('warn', 'backup returned JSON (no write access)');
      return res.status(200).json({ ok: true, files: false, data: payload, timestamp: ts });
    }
  } catch (e) {
    console.error('[ADMIN] backup error:', e.message);
    pushLog('error', `backup: ${e.message}`);
    return res.status(500).json({ ok: false, error: e.message });
  }
}


