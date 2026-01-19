// Debug normalizacji tekstu
function norm(s) {
  return s.normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const testInput = "Poproszę jedną pizzę margaritę i colę";
const normalized = norm(testInput);

console.log('Original:', testInput);
console.log('Normalized:', normalized);
console.log('Contains "pizza":', normalized.includes("pizza"));
console.log('Contains "pizze":', normalized.includes("pizze"));
console.log('Contains "margarita":', normalized.includes("margarita"));
console.log('Contains "cola":', normalized.includes("cola"));
console.log('Contains "coca":', normalized.includes("coca"));

// Sprawdź czy ma złożone zamówienie
const hasMultipleItems = (normalized.includes("pizza") && normalized.includes("cola")) ||
  (normalized.includes("pizza") && normalized.includes("frytki")) ||
  (normalized.includes("burger") && normalized.includes("cola")) ||
  (normalized.includes("margarita") && normalized.includes("cola")) ||
  (normalized.includes("pizze") && normalized.includes("cola")) ||
  (normalized.includes("pizze") && normalized.includes("frytki")) ||
  (normalized.includes("pizze") && normalized.includes("coca"));

console.log('Has multiple items:', hasMultipleItems);

// Sprawdź każdy warunek osobno
console.log('\nChecking each condition:');
console.log('pizza && cola:', normalized.includes("pizza") && normalized.includes("cola"));
console.log('pizza && frytki:', normalized.includes("pizza") && normalized.includes("frytki"));
console.log('burger && cola:', normalized.includes("burger") && normalized.includes("cola"));
console.log('margarita && cola:', normalized.includes("margarita") && normalized.includes("cola"));
console.log('pizze && cola:', normalized.includes("pizze") && normalized.includes("cola"));
console.log('pizze && frytki:', normalized.includes("pizze") && normalized.includes("frytki"));
console.log('pizze && coca:', normalized.includes("pizze") && normalized.includes("coca"));






