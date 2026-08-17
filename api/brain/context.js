// /api/brain/context.js
// Lekka pamięć sesji Amber (tylko w RAM, brak profilowania)

import {
  requireValidSessionId,
  validateSessionId
} from "./session/sessionIdContract.js";

const sessions = new Map(); // key = kanoniczny sessionId, value = kontekst rozmowy

export default async function handler(req, res) {
  try {
    const body = await req.json?.() || req.body || {};
    const { tone, intent, restaurant, items } = body;

    // Granica kontraktu sesji: brak -> missing_session_id, zly format -> invalid_session_id.
    const verdict = validateSessionId(body.session_id ?? body.sessionId);
    if (!verdict.ok) {
      return res.status(400).json({ ok: false, error: verdict.error });
    }
    const sessionId = verdict.sessionId;

    // 🔹 Pobierz istniejącą sesję
    const prev = sessions.get(sessionId) || {};

    // 🔹 Zaktualizuj dane kontekstowe
    const updated = {
      tone: tone || prev.tone || "neutralny",
      lastIntent: intent || prev.lastIntent || "unknown",
      lastRestaurant: restaurant || prev.lastRestaurant || null,
      lastItems: items?.length ? items : prev.lastItems || [],
      expectedContext: prev.expectedContext || null, // Oczekiwany kontekst follow-up
      lastUpdated: Date.now()
    };

    sessions.set(sessionId, updated);

    // 🔹 Wyczyść nieaktywne sesje (po 30 minutach)
    for (const [key, data] of sessions.entries()) {
      if (Date.now() - data.lastUpdated > 30 * 60 * 1000) {
        sessions.delete(key);
      }
    }

    return res.status(200).json({
      ok: true,
      message: "Context updated",
      session: updated
    });
  } catch (err) {
    console.error("MemoryLight error:", err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// Pomocnicza funkcja (opcjonalnie eksportowana do innych modułów)
// Fail-closed: niekanoniczny identyfikator nigdy nie odpytuje magazynu.
export function getSession(sessionId) {
  return sessions.get(requireValidSessionId(sessionId)) || null;
}

// Funkcja do aktualizacji sesji
// Fail-closed: walidacja przed set(), wiec invalid ID nie zaklada klucza.
export function updateSession(sessionId, updates) {
  const key = requireValidSessionId(sessionId);
  const current = sessions.get(key) || {};
  const updated = {
    ...current,
    ...updates,
    lastUpdated: Date.now()
  };
  sessions.set(key, updated);
  return updated;
}

// Lekka statystyka sesji dla endpointu /api/brain/stats
export function getSessionsCount() {
  return sessions.size;
}