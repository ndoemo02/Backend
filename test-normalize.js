// Test normalizacji tekstu
function stripDiacritics(s='') {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeTxt(s='') {
  return stripDiacritics(s.toLowerCase())
    .replace(/[-_]/g,' ')
    .replace(/[„"'"'.:,;!?()]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

const text = "co jest dostępne w pobliżu";
const normalized = normalizeTxt(text);

console.log('Original:', text);
console.log('Normalized:', normalized);
console.log('Contains dostępne:', normalized.includes('dostepne'));
console.log('Contains pobliżu:', normalized.includes('pobliżu'));

// Test nearby keywords
const nearbyKeywords = [
  'dostępne', 'co jest dostępne', 'co dostępne', 'co mam w pobliżu',
  'co w okolicy', 'co jest w okolicy'
];

console.log('\nTesting keywords:');
nearbyKeywords.forEach(keyword => {
  const normalizedKeyword = normalizeTxt(keyword);
  console.log(`"${keyword}" → "${normalizedKeyword}"`);
  console.log(`  Contains: ${normalized.includes(normalizedKeyword)}`);
});

