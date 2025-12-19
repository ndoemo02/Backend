/**
 * 🎯 Amber NLU Flow Patcher (v3.2 Steel Mode)
 * Wzmacnia NLU, konteksty, negacje i trace mode dla testów logicznych.
 * Uruchom: npm run patch:nlu
 */

import fs from "fs";
import path from "path";

const routerPath = "api/brain/brainRouter.js";

function patchAmberRouter() {
  if (!fs.existsSync(routerPath)) {
    console.error("❌ Nie znaleziono brainRouter.js – upewnij się że jesteś w katalogu freeflow-backend");
    process.exit(1);
  }

  let code = fs.readFileSync(routerPath, "utf8");
  let modified = false;

  // 1️⃣ — DEBUG fallback (neutralne, nie logiczne)
  const fallbackRegex = /replyCore\s*=\s*["'`](Nie jestem pewna[^"'`]+)["'`]/;
  if (fallbackRegex.test(code)) {
    code = code.replace(fallbackRegex, `replyCore = "Ooo... net gdzieś odleciał, spróbuj jeszcze raz 😅";`);
    modified = true;
  }

  // 2️⃣ — Dodanie TraceMode logów (intencja, kontekst, czas)
  if (!code.includes("🧩 NLU TRACE")) {
    code = code.replace(
      /(const resultIntent\s*=\s*[^;]+;)/,
      `$1
  const t0 = Date.now();
  console.log("🧩 NLU TRACE → intent:", resultIntent, "| expectedContext:", session?.expectedContext || "–");
  setTimeout(() => console.log("🕐 Amber tick:", Date.now() - t0, "ms"), 0);`
    );
    modified = true;
  }

  // 3️⃣ — Rozszerzona interpretacja negacji
  if (!code.includes("NEGATION_MAP")) {
    const negationPatch = `
  // 🔸 NEGATION_MAP v3.2 — poprawne rozróżnienie intencji
  const NEGATION_MAP = {
    cancel: /(anuluj|odwołaj|rezygnuj|przesta[nń])/i,
    change: /(nie|inne|zmien|zmień|inna|inny|inaczej|cofni)/i
  };

  if (ctx?.expectedContext === 'confirm_order') {
    if (NEGATION_MAP.cancel.test(lower)) {
      resultIntent = 'cancel_order';
      console.log("🚫 NLU detected CANCEL_ORDER");
    } else if (NEGATION_MAP.change.test(lower)) {
      resultIntent = 'change_restaurant';
      console.log("🔁 NLU detected CHANGE_RESTAURANT");
    }
  }`;

    code = code.replace(
      /(if\s*\(ctx\?\.expectedContext\s*===\s*'confirm_order'\)[\s\S]+?\})/,
      `$1\n${negationPatch}`
    );
    modified = true;
  }

  // 4️⃣ — Log lokalizacji i sesji
  if (!code.includes("📍 Detected location:")) {
    code = code.replace(
      /(const cuisineType = extractCuisineType\(text\);)/,
      `$1
  const loc = extractLocation(text);
  if (loc) console.log("📍 Detected location:", loc);
  else console.log("⚠️ No location detected, fallback to session.last_location");`
    );
    modified = true;
  }

  if (modified) {
    fs.writeFileSync(routerPath, code, "utf8");
    console.log("✅ Amber NLU flow patched successfully (v3.2 Steel Mode)");
  } else {
    console.log("ℹ️ Patch już zastosowany, nic do zmiany.");
  }
}

patchAmberRouter();


