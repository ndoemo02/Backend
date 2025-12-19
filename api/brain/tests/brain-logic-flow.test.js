import { describe, it, expect, beforeEach } from "vitest";
import { callBrain } from "./utils/testClient.js"; // helper, jak w innych testach

describe("🧠 Amber Brain - Logic Flow (Context & Decisions)", () => {
  let sessionId;

  beforeEach(() => {
    sessionId = `test_${Date.now()}`;
  });

  // 🧠 TEST 1 - confirm_order → change_restaurant
  it("should interpret 'nie' as change_restaurant in confirm_order context", async () => {
    await callBrain("Zamów kebaba w Piekarach", sessionId);
    await callBrain("Tak, potwierdź", sessionId);

    const result = await callBrain("Nie, inna restauracja", sessionId);

    expect(result.intent).toBe("change_restaurant");
    expect(result.reply).toMatch(/inna|zmień|spróbuj/i);
    expect(result.meta).toBeDefined();
  });

  // 🧠 TEST 2 - confirm_order → cancel_order
  it("should interpret 'anuluj' as cancel_order in confirm_order context", async () => {
    await callBrain("Zamów pizzę w Bytomiu", sessionId);
    await callBrain("Tak, potwierdź", sessionId);

    const result = await callBrain("Anuluj zamówienie", sessionId);

    expect(result.intent).toBe("cancel_order");
    expect(result.reply).toMatch(/anulowano|odwołane|ok|anulowa(ł|łam)/i);
    expect(result.meta).toBeDefined();
  });

  // 💬 TEST 3 - show_more_options follow-up
  it("should handle 'pokaż więcej' as show_more_options without resetting context", async () => {
    await callBrain("Pokaż restauracje w Piekarach", sessionId);
    await callBrain("Pokaż więcej opcji", sessionId);

    const result = await callBrain("Pokaż resztę", sessionId);

    expect(result.intent).toBe("show_more_options");
    expect(result.context.expectedContext).toBe("select_restaurant");
    expect(result.reply).toMatch(/pełna lista|opcji|numer/i);
    expect(result.meta).toBeDefined();
  });

  // 🔢 TEST 4 - select_restaurant by ordinal
  it("should interpret 'pierwszą' as select_restaurant", async () => {
    await callBrain("Pokaż restauracje w Piekarach", sessionId);

    const result = await callBrain("pierwszą", sessionId);

    expect(result.intent).toBe("select_restaurant");
    expect(result.reply).toMatch(/wybrano|menu|restaurację/i);
    expect(result.meta).toBeDefined();
  });

  // 🧾 TEST 5 - empty message validation
  it("should return 400 or warning for empty text", async () => {
    const result = await callBrain("", sessionId);

    expect(result.ok).toBe(false);
    expect(result.error || result.reply).toMatch(/brak|tekst|pusty|400/i);
    // Tutaj meta może nie być zdefiniowane dla błędu 400/200 soft error
  });

  // 🔄 TEST 6 - confirm_order loop recovery
  it("should recover to neutral context after change_restaurant", async () => {
    await callBrain("Zamów pizzę w Bytomiu", sessionId);
    await callBrain("Nie, inna restauracja", sessionId);
    await callBrain("Zamów burgera", sessionId);

    const result = await callBrain("Tak", sessionId);

    expect(result.intent).toBe("confirm_order");
    expect(result.reply).toMatch(/potwierdzam|dobrze|zapisuję/i);
    expect(['neutral', undefined, null]).toContain(result.context.expectedContext);
    expect(result.meta).toBeDefined();
  });
});
