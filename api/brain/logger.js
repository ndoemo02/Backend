// /api/brain/logger.js
import fs from "fs";
import path from "path";

const LOG_DIR = path.join(process.cwd(), 'logs');

// 💾 Debug logging function
export function saveDebugLog(sessionId, payload) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
    
    const file = path.join(LOG_DIR, `session-${sessionId}.log`);
    const entry = {
      timestamp: new Date().toISOString(),
      ...payload,
    };
    
    fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.warn("⚠️ Failed to save debug log:", err.message);
  }
}

// --- Statystyka jakości (licznik sesji) ---
export function getSessionStats(sessionId) {
  try {
    const filePath = path.join(LOG_DIR, `session-${sessionId}.log`);
    if (!fs.existsSync(filePath)) return { ok: 0, bad: 0 };

    const lines = fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
    let ok = 0,
      bad = 0;

    for (const line of lines) {
      const log = JSON.parse(line);
      if (log.type === "reply") ok++;
      if (log.type === "watchdog" || log.type === "error") bad++;
    }

    return { ok, bad };
  } catch (err) {
    console.error("❌ Błąd getSessionStats:", err);
    return { ok: 0, bad: 0 };
  }
}

