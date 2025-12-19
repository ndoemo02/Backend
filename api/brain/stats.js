// /api/brain/stats.js
import { getSessionStats } from "./logger.js";

export default function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { sessionId } = req.query;
    const stats = getSessionStats(sessionId || "default");
    return res.status(200).json(stats);
  } catch (err) {
    console.error("❌ Stats endpoint error:", err);
    return res.status(500).json({ error: err.message });
  }
}

