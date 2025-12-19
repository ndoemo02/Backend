import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCities() {
  console.log('🔍 Sprawdzam miasta w bazie...\n');

  // 1. Sprawdź czy są restauracje w Piekarach
  const { data: piekary } = await supabase
    .from('restaurants')
    .select('id, name, city, address')
    .ilike('city', '%piekary%');

  console.log('🏙️ Restauracje w Piekarach:', piekary?.length || 0);
  if (piekary?.length) {
    console.table(piekary);
  }

  // 2. Pokaż unikalne miasta w bazie
  const { data: allRestaurants } = await supabase
    .from('restaurants')
    .select('city')
    .limit(1000);

  const uniqueCities = [...new Set(allRestaurants?.map(r => r.city).filter(Boolean))].sort();
  console.log('\n📍 Dostępne miasta w bazie (' + uniqueCities.length + '):');
  uniqueCities.forEach(city => console.log('  - ' + city));

  // 3. Test parsowania lokalizacji
  console.log('\n\n🧪 Test parsowania lokalizacji:\n');
  const testCases = [
    'w Piekarach Śląskich',
    'Piekary Śląskie',
    'w Bytomiu',
    'Bytom',
    'na Bytomiu',
    'w Katowicach'
  ];

  for (const testCase of testCases) {
    const result = extractLocationTest(testCase);
    console.log(`  "${testCase}" → ${result || 'NULL'}`);
  }
}

function extractLocationTest(text) {
  const locationKeywords = ['w', 'na', 'blisko', 'koło', 'niedaleko', 'obok', 'przy'];
  const pattern = new RegExp(`(?:${locationKeywords.join('|')})\\s+([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)*)`, 'i');
  const match = text.match(pattern);
  
  let location = null;
  
  if (match) {
    location = match[1]?.trim();
  } else {
    // Fallback: Spróbuj wyłapać miasto bez przedimka (np. "Piekary Śląskie")
    const cityPattern = /\b([A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+(?:\s+[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]+)*)\b/g;
    const cities = text.match(cityPattern);
    if (cities && cities.length > 0) {
      // Weź ostatnie słowo z dużej litery (najprawdopodobniej miasto)
      location = cities[cities.length - 1];
    }
  }
  
  if (!location) return null;
  
  const blacklist = ['tutaj', 'tu', 'szybko', 'pobliżu', 'okolicy', 'menu', 'coś', 'cos', 'azjatyckiego', 'azjatyckie', 'szybkiego', 'dobrego', 'innego', 'Zamów', 'Pokaż', 'Znajdź', 'Chcę'];
  const locationLower = location.toLowerCase();
  
  if (blacklist.includes(locationLower) || blacklist.some(word => locationLower.startsWith(word + ' '))) {
    return null;
  }
  
  // Normalize case endings for Polish cities
  // 🔧 Obsługa złożonych nazw (np. "Piekarach Śląskich" → "Piekary Śląskie")
  location = location
    .split(' ')
    .map(word => {
      // Priorytety: najpierw dłuższe końcówki, potem krótsze
      if (/ich$/i.test(word)) {
        return word.replace(/ich$/i, 'ie');  // Śląskich → Śląskie (najpierw!)
      }
      if (/im$/i.test(word)) {
        return word.replace(/im$/i, 'ie');   // Śląskim → Śląskie
      }
      if (/ach$/i.test(word)) {
        return word.replace(/ach$/i, 'y');  // Piekarach → Piekary
      }
      if (/ami$/i.test(word)) {
        return word.replace(/ami$/i, 'a');   // Gliwicami → Gliwica
      }
      if (/iu$/i.test(word)) {
        return word.replace(/iu$/i, '');     // Bytomiu → Bytom
      }
      // Wyjątek: Nie zamieniaj "-ie" jeśli słowo już jest w mianowniku (np. "Śląskie", "Pomorskie")
      const adjectiveEndings = /skie$/i;
      if (adjectiveEndings.test(word)) {
        return word; // Zostaw bez zmian
      }
      if (/ie$/i.test(word)) {
        return word.replace(/ie$/i, 'a');    // Katowicie → Katowica
      }
      return word;
    })
    .join(' ');
  
  return location;
}

checkCities();

