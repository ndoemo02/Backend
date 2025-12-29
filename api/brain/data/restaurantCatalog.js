
/**
 * Static Catalog of FreeFlow Restaurants.
 * Allows instant, DB-free matching in NLU.
 * 
 * Based on production data dump.
 */

export const RESTAURANT_CATALOG = [
    {
        id: '1fc1e782-bac6-47b2-978a-f6f2b38000cd',
        name: 'Restauracja Stara Kamienica',
        aliases: ['stara kamienica', 'kamienica', 'kamienicy'],
        city: 'Piekary Śląskie',
        cuisine: 'Polska'
    },
    {
        id: '4d27fbe3-20d0-4eb4-b003-1935be53af25',
        name: 'Rezydencja Luxury Hotel',
        aliases: ['rezydencja', 'luxury', 'rezydencji'],
        city: 'Piekary Śląskie',
        cuisine: 'Międzynarodowa'
    },
    {
        id: '569a7d29-57be-4224-bdf3-09c483415cea',
        name: 'Klaps Burgers',
        aliases: ['klaps', 'klapsa', 'burgerownia'],
        city: 'Piekary Śląskie',
        cuisine: 'Amerykańska'
    },
    {
        id: '70842598-1632-43f6-8015-706d5adf182f',
        name: 'Vien-Thien',
        aliases: ['vien thien', 'wietnamska', 'chinczyk', 'chińczyk'],
        city: 'Piekary Śląskie',
        cuisine: 'Wietnamska'
    },
    {
        id: '8b00b05e-72f7-4a5f-b50c-5630a75d6312',
        name: 'Bar Praha',
        aliases: ['bar praha', 'praha', 'praga', 'bar praga'],
        city: 'Piekary Śląskie',
        cuisine: 'Czeska / Polska'
    },
    {
        id: 'bd9f2244-7618-4071-aa96-52616a7b4c70',
        name: 'Callzone',
        aliases: ['callzone', 'kalzone', 'calzone'],
        city: 'Piekary Śląskie',
        cuisine: 'Pizzeria'
    },
    {
        id: 'af8448ef-974b-46c8-a4ae-b04b8dc7c9f8',
        name: 'Dwór Hubertus',
        aliases: ['dwór hubertus', 'hubertus', 'hubertusa', 'dwor hubertus'],
        city: 'Piekary Śląskie',
        cuisine: 'Śląska / Europejska'
    },
    {
        id: 'fc844513-2869-4f42-b04f-c21e1e4cceb7',
        name: 'Tasty King Kebab',
        aliases: ['tasty king', 'tasty', 'king kebab', 'król kebaba'],
        city: 'Piekary Śląskie',
        cuisine: 'Kebab'
    },
    {
        id: '83566974-1017-4408-90ee-2571ccc06978',
        name: 'Pizzeria Monte Carlo',
        aliases: ['monte carlo', 'monte', 'carlo'],
        city: 'Piekary Śląskie',
        cuisine: 'Pizzeria'
    }
];

import { normalizeTxt } from '../intents/intentRouterGlue.js';

export function findRestaurantInText(text) {
    const normalized = normalizeTxt(text);

    // Helper: check if alias appears as whole word(s) in text
    const matchesAsWord = (aliasNormalized, textNormalized) => {
        // Create regex that matches the alias as whole word(s)
        // Escape special regex characters in alias
        const escaped = aliasNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        return regex.test(textNormalized);
    };

    // Sort by name length descending to match longest alias first
    const candidates = RESTAURANT_CATALOG.sort((a, b) => b.name.length - a.name.length);

    for (const rest of candidates) {
        // Check main name (word boundary match)
        const nameNorm = normalizeTxt(rest.name);
        if (matchesAsWord(nameNorm, normalized)) return rest;

        // Check aliases (word boundary match)
        if (rest.aliases && rest.aliases.some(alias => matchesAsWord(normalizeTxt(alias), normalized))) {
            return rest;
        }
    }
    return null;
}
