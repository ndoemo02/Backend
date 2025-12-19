// api/admin/amber-learning-stats.js
// Zwraca statystyki „uczenia Amber” na podstawie tabeli amber_intents.

import { supabase } from "../_supabase.js";

function forbid(res) {
  return res.status(403).json({ ok: false, error: "forbidden" });
}

function inferFeedbackScore(row) {
  // Preferuj explicite zapisany feedback_score, jeśli istnieje
  if (typeof row.feedback_score === "number") return row.feedback_score;
  if (typeof row.feedback === "number") return row.feedback;
  if (typeof row.is_positive === "boolean") return row.is_positive ? 1 : 0;

  // Fallback: traktuj fallback=true jako „negatywny”, fallback=false jako „pozytywny”
  if (typeof row.fallback === "boolean") return row.fallback ? 0 : 1;

  return null; // neutralny / brak danych
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res
        .status(405)
        .json({ ok: false, error: "method_not_allowed" });
    }

    // Dodatkowe zabezpieczenie (oprócz verifyAmberAdmin)
    const token =
      req.headers["x-admin-token"] ||
      req.headers["X-Admin-Token"] ||
      req.headers["x-Admin-Token"] ||
      req.query.token ||
      req.query.admin_token;
    if (!token || token !== process.env.ADMIN_TOKEN) return forbid(res);

    const limit = Math.min(parseInt(req.query.limit || "20", 10), 200);

    // Całkowita liczba rekordów
    let total = 0;
    try {
      const { count } = await supabase
        .from("amber_intents")
        .select("id", { count: "exact", head: true });
      total = count || 0;
    } catch {
      total = 0;
    }

    // Ostatnie rekordy
    const { data, error } = await supabase
      .from("amber_intents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];

    const feedbackStats = { positive: 0, negative: 0, neutral: 0 };
    const intentStats = {};

    const latest = rows.map((r) => {
      const feedback_score = inferFeedbackScore(r);

      if (feedback_score === 1) feedbackStats.positive += 1;
      else if (feedback_score === 0) feedbackStats.negative += 1;
      else feedbackStats.neutral += 1;

      const intent = r.intent || "unknown";
      intentStats[intent] = (intentStats[intent] || 0) + 1;

      return {
        intent,
        feedback_score,
        input_text:
          r.input_text ||
          r.inputText ||
          r.user_text ||
          r.userText ||
          null,
        created_at: r.created_at || r.timestamp || null,
      };
    });

    return res.status(200).json({
      ok: true,
      total,
      latest,
      intentStats,
      feedbackStats,
    });
  } catch (e) {
    return res
      .status(500)
      .json({
        ok: false,
        error: e.message,
        total: 0,
        latest: [],
        intentStats: {},
        feedbackStats: { positive: 0, negative: 0, neutral: 0 },
      });
  }
}


