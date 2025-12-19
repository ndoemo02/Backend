import { normalize } from "../utils/normalizeText.js";

export const cuisineAliases = {
  // Azjatycka
  'azjatyckie': ['Wietnamska', 'Chińska', 'Tajska'],
  'azjatyckiej': ['Wietnamska', 'Chińska', 'Tajska'],
  'orientalne': ['Wietnamska', 'Chińska'],
  'orientalnej': ['Wietnamska', 'Chińska'],

  // Fast food
  'fastfood': ['Amerykańska', 'Kebab'],
  'fast food': ['Amerykańska', 'Kebab'],
  'na szybko': ['Amerykańska', 'Kebab'],
  'szybkie': ['Amerykańska', 'Kebab'],
  'cos szybkiego': ['Amerykańska', 'Kebab'],
  'cos lekkiego': ['Amerykańska', 'Kebab'],
  'na zab': ['Amerykańska', 'Kebab'],

  // Burger
  'burger': ['Amerykańska'],
  'burgera': ['Amerykańska'],
  'burgerow': ['Amerykańska'],

  // Pizza
  'pizza': ['Włoska'],
  'pizze': ['Włoska'],
  'pizzy': ['Włoska'],
  'wloska': ['Włoska'],
  'wloskiej': ['Włoska'],

  // Kebab
  'kebab': ['Kebab'],
  'kebaba': ['Kebab'],
  'kebabu': ['Kebab'],

  // Lokalne / Regionalne
  'lokalne': ['Polska', 'Śląska / Europejska', 'Czeska / Polska'],
  'lokalnej': ['Polska', 'Śląska / Europejska', 'Czeska / Polska'],
  'domowe': ['Polska', 'Śląska / Europejska'],
  'domowej': ['Polska', 'Śląska / Europejska'],
  'regionalne': ['Polska', 'Śląska / Europejska', 'Czeska / Polska'],
  'regionalnej': ['Polska', 'Śląska / Europejska', 'Czeska / Polska'],
  'polska': ['Polska'],
  'polskiej': ['Polska'],

  // Europejska
  'europejska': ['Śląska / Europejska', 'Czeska / Polska', 'Włoska'],
  'europejskiej': ['Śląska / Europejska', 'Czeska / Polska', 'Włoska'],

  // Wege (fallback — brak w bazie, ale obsługa)
  'wege': [],
  'wegetarianskie': [],
  'wegetarianskiej': []
};

export function expandCuisineType(cuisineType) {
  if (!cuisineType) return null;

  const normalized = normalize(cuisineType);

  // Jeśli użytkownik podał alias (np. "azjatyckie"), zwróć listę typów kuchni
  if (cuisineAliases[normalized]) {
    console.log(`🔄 Cuisine alias expanded: "${cuisineType}" → [${cuisineAliases[normalized].join(', ')}]`);
    return cuisineAliases[normalized];
  }

  // Jeśli użytkownik podał dokładny typ kuchni, zwróć go w tablicy
  return [cuisineType];
}

export function extractCuisineType(text) {
  if (!text) return null;

  const normalized = normalize(text);

  const cuisineMap = {
    // Dokładne typy kuchni
    'wloska': 'Włoska',
    'wloskiej': 'Włoska',
    'polska': 'Polska',
    'polskiej': 'Polska',
    'slaska': 'Śląska / Europejska',
    'śląska': 'Śląska / Europejska',
    'slaskiej': 'Śląska / Europejska',
    'śląskiej': 'Śląska / Europejska',
    'czeska': 'Czeska / Polska',
    'czeskiej': 'Czeska / Polska',
    'kebaby': 'Kebab',
    'kebab': 'Kebab',
    'burgery': 'Amerykańska',
    'burger': 'Amerykańska',
    'burgera': 'Amerykańska',
    'burgerow': 'Amerykańska',

    // Aliasy semantyczne
    'azjatyckie': 'azjatyckie',
    'azjatyckiej': 'azjatyckiej',
    'orientalne': 'orientalne',
    'orientalnej': 'orientalnej',
    'fastfood': 'fastfood',
    'fast food': 'fast food',
    'lokalne': 'lokalne',
    'lokalnej': 'lokalnej',
    'domowe': 'domowe',
    'domowej': 'domowej',
    // Wege (fallback)
    'wege': 'wege',
    'wegetarianskie': 'wege',
    'wegetarianskiej': 'wege'
  };

  for (const [keyword, cuisineType] of Object.entries(cuisineMap)) {
    if (normalized.includes(keyword)) {
      console.log(`🍕 Extracted cuisine type: "${cuisineType}" (keyword: "${keyword}")`);
      return cuisineType;
    }
  }

  return null;
}
