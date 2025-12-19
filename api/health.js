import { applyCORS } from "./_cors.js";
import { supabase } from "./_supabase.js";

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;
  
  try {
    const { error } = await supabase.from("restaurants").select("id").limit(1);
    if (error) throw error;
    
    res.status(200).json({
      ok: true,
      service: "FreeFlow Voice Expert",
      node: process.version,
      timestamp: new Date().toISOString(),
      supabase: { ok: true },
    });
  } catch (err) {
    console.error("❌ Health check error:", err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}