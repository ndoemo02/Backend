import {
  getRestaurantAliases,
  upsertRestaurantAlias,
  deleteRestaurantAlias
} from "../config/configService.js";

function forbid(res) {
  return res.status(403).json({ ok: false, error: "forbidden" });
}

export default async function handler(req, res) {
  const token =
    req.headers["x-admin-token"] ||
    req.headers["X-Admin-Token"] ||
    req.headers["x-Admin-Token"] ||
    req.query.token;
  if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

  if (req.method === "GET") {
    try {
      const aliases = await getRestaurantAliases();
      return res.status(200).json({ ok: true, aliases });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = req.body || {};
      const { alias, canonical } = body;
      const aliases = await upsertRestaurantAlias(alias, canonical);
      return res.status(200).json({ ok: true, aliases });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  if (req.method === "DELETE") {
    try {
      const { alias } = req.body || {};
      const aliases = await deleteRestaurantAlias(alias);
      return res.status(200).json({ ok: true, aliases });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}

