
import { describe, it, expect } from "vitest";
import { normalizeSize, normalizeExtras, normalizeExclusions } from "../order/variantNormalizer.js";

describe("normalizeSize", () => {
  it("rozpoznaje małą pizzę", () => {
    expect(normalizeSize("poproszę małą pepperoni")).toBe("small");
  });
  it("rozpoznaje średnią pizzę", () => {
    expect(normalizeSize("weź średnia margarite")).toBe("medium");
  });
  it("rozpoznaje dużą pizzę", () => {
    expect(normalizeSize("duża hawajska")).toBe("large");
  });
  it("rozpoznaje max/mega/giga jako XXL", () => {
    expect(normalizeSize("mega pepperoni")).toBe("xxl");
    expect(normalizeSize("giga kebab")).toBe("xxl");
  });
  it("zwraca null jeśli brak rozmiaru", () => {
    expect(normalizeSize("pepperoni proszę")).toBe(null);
  });
});

describe("normalizeExtras", () => {
  it("wykrywa podwójne mięso", () => {
    expect(normalizeExtras("poproszę kebaba podwójne mięso")).toContain("double_meat");
  });
  it("wykrywa extra ser", () => {
    expect(normalizeExtras("pizza z podwójnym serem")).toContain("extra_cheese");
  });
  it("wykrywa ostre", () => {
    expect(normalizeExtras("poproszę ostrą wersję")).toContain("spicy");
  });
  it("zwraca pustą tablicę gdy brak dodatków", () => {
    expect(normalizeExtras("poproszę margarite")).toEqual([]);
  });
  it("wykrywa literówki w dodatkach (czsnkowy)", () => {
    expect(normalizeExtras("poproszę sos czsnkowy")).toContain("garlic_sauce");
  });
  it("wykrywa literówki w dodatkach (ketchp)", () => {
    expect(normalizeExtras("ketchp proszę")).toContain("ketchup");
  });
});

describe("normalizeExclusions", () => {
  it("wykrywa bez cebuli", () => {
    expect(normalizeExclusions("poproszę burgera bez cebuli")).toContain("onion");
  });
  it("wykrywa nie chce sosu", () => {
    expect(normalizeExclusions("nie chce sosu")).toContain("sauce");
  });
  it("wykrywa bez pomidora", () => {
    expect(normalizeExclusions("bez pomidora")).toContain("tomato");
  });
  it("zwraca nieznane wykluczenie jako surowe słowo", () => {
    expect(normalizeExclusions("bez ananasa")).toContain("ananasa");
  });
});

