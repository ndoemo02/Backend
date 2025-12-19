// /api/brain/context.js
// Lekka pamięć sesji Amber (tylko w RAM, brak profilowania)

const sessions = new Map(); // key = sessionId, value = kontekst rozmowy

export default async function handler(req, res) {
  try {
    const body = await req.json?.() || req.body || {};
    const { sessionId, tone, intent, restaurant, items } = body;

    if (!sessionId) {
      return res.status(400).json({ ok: false, error: "missing_sessionId" });
    }

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
export function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

// Funkcja do aktualizacji sesji
export function updateSession(sessionId, updates) {
  const current = sessions.get(sessionId) || {};
  const updated = {
    ...current,
    ...updates,
    lastUpdated: Date.now()
  };
  sessions.set(sessionId, updated);
  return updated;
}

// Lekka statystyka sesji dla endpointu /api/brain/stats
export function getSessionsCount() {
  return sessions.size;
}