
/**
 * Static Catalog of FreeFlow Restaurants.
 * Allows instant, DB-free matching in NLU.
 * 
 * Based on production data dump.
 */

export const RESTAURANT_CATALOG = [
    {
        id: 'acced74f-ddac-43a0-9f78-016c397f4b8e',
        name: 'Silesiana Italiana',
        aliases: [
            'silesiana italiana',
            'silesiana',
            'w silesianie italianie',
            'silesiany italiany'
        ],
        city: 'Piekary Śląskie',
        cuisine: 'Nowoczesna kuchnia włosko-śląska',
        demo: true
    },
    {
        id: '6cce66fb-4d2d-402f-abe5-22e9784d559c',
        name: 'Ruszt i Ogień',
        aliases: [
            'ruszt i ogień',
            'ruszt i ogien',
            'w ruszcie i ogniu',
            'ruszt'
        ],
        city: 'Piekary Śląskie',
        cuisine: 'Grill i kuchnia ognia',
        demo: true
    },
    {
        id: 'a2be7ddb-d1dd-49d6-9026-57ecd4c94d60',
        name: 'Syto po Naszymu',
        aliases: [
            'syto po naszymu',
            'w syto po naszymu',
            'po naszymu'
        ],
        city: 'Piekary Śląskie',
        cuisine: 'Domowa kuchnia śląska i polska',
        demo: true
    },
    {
        id: '72c76694-f533-46b8-b831-1965210a0cb4',
        name: 'Kebs & Roll',
        aliases: [
            'kebs & roll',
            'kebs and roll',
            'kebs roll',
            'cups & roll',
            'cups and roll',
            'keps and roll',
            'kebs'
        ],
        city: 'Piekary Śląskie',
        cuisine: 'Nowoczesny kebab i street food',
        demo: true
    },
    {
        id: '4ad6b301-671b-4343-bf91-9bab7cda37b4',
        name: 'Śląski Szynk',
        aliases: [
            'śląski szynk',
            'slaski szynk',
            'śląskiego szynku',
            'slaskiego szynku',
            'w śląskim szynku',
            'w slaskim szynku',
            'szynk'
        ],
        city: 'Piekary Śląskie',
        cuisine: 'Nowoczesna kuchnia śląska',
        demo: true
    },
    {
        id: '1fc1e782-bac6-47b2-978a-f6f2b38000cd',
        name: 'Restauracja Stara Kamienica',
        aliases: ['stara kamienica', 'kamienica', 'kamienicy', 'kamienicy'],
        city: 'Piekary Śląskie',
        cuisine: 'Polska'
    },
    {
        id: '4d27fbe3-20d0-4eb4-b003-1935be53af25',
        name: 'Rezydencja Luxury Hotel',
        aliases: ['rezydencja', 'luxury', 'rezydencji', 'rezydencja luxury hotel'],
        city: 'Piekary Śląskie',
        cuisine: 'Międzynarodowa'
    },
    {
        id: '569a7d29-57be-4224-bdf3-09c483415cea',
        name: 'Klaps Burgers',
        aliases: ['klaps', 'klapsa', 'klapsie', 'klapsem'],
        city: 'Piekary Śląskie',
        cuisine: 'Amerykańska'
    },
    {
        id: '70842598-1632-43f6-8015-706d5adf182f',
        name: 'Vien-Thien',
        aliases: ['vien thien', 'wietnamska', 'chinczyk', 'chińczyk', 'vienta', 'vienten'],
        city: 'Piekary Śląskie',
        cuisine: 'Wietnamska'
    },
    {
        id: '8b00b05e-72f7-4a5f-b50c-5630a75d6312',
        name: 'Bar Praha',
        aliases: ['bar praha', 'praha', 'praga', 'bar praga', 'praze', 'pradze'],
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
        aliases: ['dwór hubertus', 'hubertus', 'hubertusa', 'dwor hubertus', 'hubertusie', 'hubertusem'],
        city: 'Piekary Śląskie',
        cuisine: 'Śląska / Europejska'
    },
    {
        id: 'fc844513-2869-4f42-b04f-c21e1e4cceb7',
        name: 'Tasty King Kebab',
        aliases: ['tasty king', 'tasty', 'king kebab', 'król kebaba', 'tastiego'],
        city: 'Piekary Śląskie',
        cuisine: 'Kebab'
    },
    {
        id: '222d1e64-5d87-4f78-a0ca-f92da4f76d65',
        name: 'LAWASZ KEBAB',
        aliases: ['lawasz', 'lawasz kebab', 'lawasz kebs', 'lawaszkebab'],
        city: 'Piekary Śląskie',
        cuisine: 'Kebab'
    },
    {
        id: '83566974-1017-4408-90ee-2571ccc06978',
        name: 'Pizzeria Monte Carlo',
        aliases: ['monte carlo', 'monte', 'carlo', 'monte carlo'],
        city: 'Piekary Śląskie',
        cuisine: 'Pizzeria'
    }
];

export const DEMO_RESTAURANT_IDS = new Set(
    RESTAURANT_CATALOG.filter((restaurant) => restaurant.demo === true).map((restaurant) => restaurant.id)
);

export function isPublicDemoCatalogOnly(env = process.env) {
    return /^(1|true|yes|on)$/i.test(String(env?.FREEFLOW_DEMO_CATALOG_ONLY || '').trim());
}

export function filterRestaurantsForPublicDemo(restaurants, demoOnly = isPublicDemoCatalogOnly()) {
    if (!Array.isArray(restaurants)) return [];
    if (!demoOnly) return restaurants;
    return restaurants.filter((restaurant) => DEMO_RESTAURANT_IDS.has(String(restaurant?.id || '')));
}

import { normalizeTxt } from '../intents/intentRouterGlue.js';

export function findRestaurantInText(text, { demoOnly = isPublicDemoCatalogOnly() } = {}) {
    const normalized = normalizeTxt(text);
    console.log(`🔍 findRestaurantInText: normalized input="${normalized}"`);

    // Helper: check if alias appears as whole word(s) in text
    const matchesAsWord = (aliasNormalized, textNormalized) => {
        // Create regex that matches the alias as whole word(s)
        // Escape special regex characters in alias
        const escaped = aliasNormalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        const match = regex.test(textNormalized);
        if (match) console.log(`✅ Match found for alias "${aliasNormalized}" in "${textNormalized}"`);
        return match;
    };

    // Sort by name length descending to match longest alias first
    const candidates = filterRestaurantsForPublicDemo(RESTAURANT_CATALOG, demoOnly)
        .sort((a, b) => b.name.length - a.name.length);

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
