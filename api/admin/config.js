// api/admin/config.js
import { getConfig, updateConfig } from "../config/configService.js";

function forbid(res) { return res.status(403).json({ ok: false, error: 'forbidden' }); }

export default async function handler(req, res) {
  const token = req.headers['x-admin-token'] || req.headers['X-Admin-Token'] || req.headers['x-Admin-Token'] || req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

  if (req.method === 'GET') {
    try {
      const cfg = await getConfig();
      return res.status(200).json({ ok: true, config: cfg });
    } catch (e) {
      return res.status(200).json({ ok: true, config: {} });
    }
  }
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const { key, value } = body;
      const cfg = await updateConfig(String(key), value);
      return res.status(200).json({ ok: true, config: cfg });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }
  return res.status(405).json({ ok: false, error: 'method_not_allowed' });
}


