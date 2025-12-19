// scripts/enrich-places.ts
import 'dotenv/config';
import fetch from 'node-fetch';
import { Pool } from 'pg';

const BASE = process.env.API_BASE || "http://localhost:3003";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const { rows } = await pool.query(`
    select id from public.restaurants
    where enriched_at is null
       or maps_rating is null
       or full_address is null
    order by name asc
    limit 100
  `);

  console.log(`Do wzbogacenia: ${rows.length}`);
  for (const r of rows) {
    const url = `${BASE}/api/restaurants/enrich?id=${encodeURIComponent(r.id)}`;
    const res = await fetch(url);
    const j = await res.json();
    console.log(res.status, r.id, j?.result?.name || "", j?.result?.maps_rating || "-", j?.result?.full_address || "-");
    // lekki throttling (szczególnie gdy OSM)
    await new Promise(r => setTimeout(r, 400));
  }

  await pool.end();
})();
