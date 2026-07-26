/**
 * Food Domain: Menu Handler
 * Odpowiada za wyswietlanie karty dan (Menu).
 */

import { loadMenuPreview } from '../../menuService.js';
import { findRestaurantByName, getLocationFallback } from '../../locationService.js';
import { RESTAURANT_CATALOG } from '../../data/restaurantCatalog.js';

function normalizeMenuToken(value) {
    return String(value || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const DRINK_SIGNALS = [
    'napoj', 'piwo', 'cola', 'kola', 'sok', 'woda', 'herbata', 'kawa', 'lemo',
    'sprite', 'fanta', 'pepsi', 'monster', 'energy', 'juice', 'beer', 'wino',
    'wine', 'koktajl', 'smoothie', 'shake', 'mleko', 'limon',
];

const MENU_FOCUS_QUERIES = [
    {
        kind: 'dessert',
        promptSignals: ['deser', 'desery', 'slodk', 'ciasto', 'ciasta', 'sernik', 'krem', 'czekolad'],
        itemSignals: ['deser', 'desery', 'slodk', 'ciasto', 'ciasta', 'sernik', 'krem', 'czekolad', 'lody', 'lod'],
        label: 'czegos slodkiego',
    },
    {
        kind: 'ice_cream',
        promptSignals: ['lody', 'lodow', 'loda', 'lodowe', 'ice cream', 'gelato'],
        itemSignals: ['lody', 'lodow', 'loda', 'lodowe', 'ice cream', 'gelato'],
        label: 'lodow',
    },
    {
        kind: 'drink',
        promptSignals: ['napoj', 'napoje', 'picia', 'picie', 'cola', 'kola', 'sok', 'woda', 'herbata', 'kawa'],
        itemSignals: DRINK_SIGNALS,
        label: 'napojow',
    },
];

function isLikelyDrink(item) {
    const name = normalizeMenuToken(item?.name || item?.base_name || '');
    if (DRINK_SIGNALS.some((s) => name.includes(s))) return true;
    // numeric volume: 0.85, 0.33, 500ml etc.
    if (/\b0\.\d+\b/.test(name)) return true;
    if (/\b\d{3,4}\s*ml\b/.test(name)) return true;
    return false;
}

function findMenuFocusForText(text, menuItems = []) {
    const normalizedText = normalizeMenuToken(text);
    if (!normalizedText) return null;

    const query = MENU_FOCUS_QUERIES.find((candidate) =>
        candidate.promptSignals.some((signal) => normalizedText.includes(signal))
    );
    if (!query) return null;

    const matches = (Array.isArray(menuItems) ? menuItems : [])
        .filter((item) => item?.available !== false)
        .filter((item) => {
            const haystack = normalizeMenuToken([
                item?.name,
                item?.base_name,
                item?.category,
                item?.item_family,
                Array.isArray(item?.item_tags) ? item.item_tags.join(' ') : '',
                Array.isArray(item?.item_aliases) ? item.item_aliases.join(' ') : '',
            ].filter(Boolean).join(' '));

            if (query.kind === 'drink' && isLikelyDrink(item)) return true;
            return query.itemSignals.some((signal) => haystack.includes(signal));
        });

    return {
        query,
        matches,
        focusedMenuItemId: matches[0]?.id || matches[0]?.menuItemId || matches[0]?.menu_item_id || null,
    };
}

function buildFocusedMenuReply(restaurantName, focusResult) {
    if (!focusResult) return null;
    const matches = Array.isArray(focusResult.matches) ? focusResult.matches : [];
    if (!matches.length) {
        return `Nie widze w menu ${restaurantName} pozycji pasujacych do ${focusResult.query.label}. Mozesz wybrac cos innego z karty.`;
    }

    const names = matches
        .slice(0, 4)
        .map((item) => String(item?.base_name || item?.name || '').trim())
        .filter(Boolean);
    return `W menu ${restaurantName} pasuje: ${names.join(', ')}. Co wybierasz?`;
}

function buildNaturalMenuReplySummary(menuItems = []) {
    const items = Array.isArray(menuItems) ? menuItems : [];
    const sizes = new Set();
    const highlights = [];
    const seenHighlights = new Set();

    for (const item of items.slice(0, 40)) {
        // Highlights: nazwy dan (bez rozmiarow w tytule)
        const rawName = String(item?.base_name || item?.name || '').trim();
        if (rawName) {
            const cleanedName = rawName
                .replace(/\b(XXL|XL|L|M|S)\b/gi, ' ')
                .replace(/\b(duza|duzy|mala|maly|standard|mega)\b/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            const displayName = cleanedName || rawName;
            const key = normalizeMenuToken(displayName);
            if (key && !seenHighlights.has(key)) {
                seenHighlights.add(key);
                highlights.push(displayName);
            }
        }

        // Rozmiary tylko z dan (nie napojow) i tylko standardowe: S/M/L/XL/XXL
        if (!isLikelyDrink(item)) {
            const variantRaw = String(item?.size_or_variant || '').trim();
            const variantFromName = String(item?.name || '').match(/\b(XXL|XL|L|M|S)\b/i)?.[1] || '';
            const variant = (variantRaw || variantFromName).trim();
            if (variant && /^(XXL|XL|L|M|S)$/i.test(variant)) {
                sizes.add(variant.toUpperCase());
            }
        }
    }

    const sizeList = Array.from(sizes).slice(0, 3);
    const highlightList = highlights.slice(0, 4);

    // Podsumowanie: nazwy dan maja priorytet nad kategoriami bialkowymi
    const summaryLine = highlightList.length > 0
        ? `W karcie znajdziesz m.in. ${highlightList.join(', ')}.`
        : 'W karcie jest sporo roznych pozycji.';

    // Pytanie o rozmiar tylko gdy sa 2+ rzeczywiste rozmiary dan (nie napojow)
    const followUpQuestion = sizeList.length >= 2
        ? `Wolisz rozmiar ${sizeList.slice(0, 2).join(' czy ')}?`
        : 'Na co masz ochote?';

    return { summaryLine, followUpQuestion };
}

export class MenuHandler {
    async execute(ctx) {
        const { text, session, entities, sessionId } = ctx;
        if (!sessionId) {
            throw new Error('MenuHandler: sessionId missing');
        }
        console.log(`MenuHandler executing for session ${sessionId}. Text: "${text}"`);
        console.log(`MenuHandler: session lastRestaurant: ${session?.lastRestaurant?.name} (${session?.lastRestaurant?.id})`);
        console.log('MenuHandler: entities:', JSON.stringify(entities));

        // 1. Zidentyfikuj restauracje
        let restaurant = null;
        let matchedFromText = false;

        // A) Jawnie w tekscie (ID z katalogu ma priorytet)
        if (entities?.restaurantId) {
            const catalogMatch = RESTAURANT_CATALOG.find((r) => r.id === entities.restaurantId);
            if (catalogMatch) {
                restaurant = catalogMatch;
                matchedFromText = true;
            }
        }

        // B) Jawnie w tekscie (nazwa jesli ID brak - np. spoza katalogu)
        if (!restaurant && entities?.restaurant) {
            restaurant = await findRestaurantByName(entities.restaurant);
            if (restaurant) matchedFromText = true;
        }

        // C) Z sesji (Context)
        if (!restaurant) {
            restaurant = session?.currentRestaurant || session?.lastRestaurant;
        }

        // 2. Walidacja: Brak restauracji
        if (!restaurant) {
            const fallback = await getLocationFallback(
                sessionId,
                session?.last_location,
                'Najpierw wybierz restauracje w {location}, a potem pokaze menu:\n{list}\n\nKtora Cie interesuje?'
            );

            if (fallback) {
                return { reply: fallback };
            }

            return {
                reply: "Najpierw wybierz restauracje. Powiedz 'gdzie zjesc w poblizu' aby zobaczyc liste.",
                contextUpdates: { expectedContext: 'find_nearby' },
            };
        }

        // 2.5 Base Context Updates
        const baseContextUpdates = {
            lastRestaurant: restaurant,
            expectedContext: 'create_order', // will be overwritten if matchedFromText
            lastIntent: 'menu_request',
            context: 'IN_RESTAURANT',
            lockedRestaurantId: restaurant.id,
        };

        if (matchedFromText) {
            console.log(`MenuHandler: matched restaurant from text -> ${restaurant.name}, resetting conversation phase`);
            baseContextUpdates.currentRestaurant = restaurant;
            baseContextUpdates.conversationPhase = 'restaurant_selected';
            baseContextUpdates.last_restaurants_list = [];
            baseContextUpdates.expectedContext = 'menu_or_order';
        }

        // --- OPTIMIZATION: Task 2 - Menu Cache Shortcut ---
        const sessionRestaurant = session?.currentRestaurant || session?.lastRestaurant;
        const cachedRestaurantId = session?.last_menu_restaurant_id;
        const canUseCache =
            sessionRestaurant &&
            restaurant.id === sessionRestaurant.id &&
            cachedRestaurantId === restaurant.id &&
            session?.last_menu &&
            session.last_menu.length > 0;

        if (canUseCache) {
            console.log(`Cache Hit: Returning cached menu for ${sessionRestaurant.name}`);
            console.log(`[MenuCache] HIT restaurant=${restaurant.id} items=${session.last_menu.length}`);
            const items = session.last_menu;
            const focusResult = findMenuFocusForText(text, items);
            if (focusResult) {
                return {
                    intent: 'menu_request',
                    reply: buildFocusedMenuReply(sessionRestaurant.name, focusResult),
                    menuItems: items,
                    restaurants: [],
                    meta: {
                        source: 'cache_menu_focus',
                        latency_total_ms: 0,
                        menuPresentationMode: focusResult.focusedMenuItemId ? 'discovery' : 'full',
                        focusedMenuItemId: focusResult.focusedMenuItemId,
                        menuFocusQuery: focusResult.query.kind,
                    },
                    contextUpdates: { ...baseContextUpdates },
                };
            }

            const menuSummary = buildNaturalMenuReplySummary(items);

            // Anti-Loop for Cache
            if (session.lastIntent === 'show_menu' || session.lastIntent === 'menu_request') {
                return {
                    intent: 'menu_request', // Standard V2
                    reply: 'Liste dan masz na ekranie. Czy cos wpadlo Ci w oko?',
                    menuItems: items,
                    restaurants: [],
                    meta: {
                        source: 'cache_anti_loop',
                        latency_total_ms: 0,
                        menuPresentationMode: 'full',
                    },
                    contextUpdates: { ...baseContextUpdates },
                };
            }

            return {
                intent: 'menu_request', // Standard V2
                reply: `Wybrano restauracje ${sessionRestaurant.name}. ${menuSummary.summaryLine} ${menuSummary.followUpQuestion}`,
                menuItems: items,
                restaurants: [],
                meta: {
                    source: 'cache',
                    latency_total_ms: 0,
                    menuPresentationMode: 'full',
                },
                contextUpdates: { ...baseContextUpdates },
            };
        }

        // 3. Pobierz Menu (DB)
        const preview = await loadMenuPreview(restaurant.id, {});

        if (!preview || !preview.menu || !preview.menu.length) {
            return {
                reply: `Przepraszam, ale nie mam jeszcze menu dla ${restaurant.name}.`,
            };
        }

        // 4. Formatowanie odpowiedzi
        const count = preview.menu.length;
        const menuItemsForAssistant = preview.menu;
        const shown = menuItemsForAssistant.length;
        const focusResult = findMenuFocusForText(text, preview.menu);
        if (focusResult) {
            console.log(`MenuHandler: focused ${focusResult.matches.length}/${count} items for ${restaurant.name} query=${focusResult.query.kind}`);
            return {
                intent: 'menu_request',
                reply: buildFocusedMenuReply(restaurant.name, focusResult),
                closing_question: focusResult.matches.length ? 'Co wybierasz?' : 'Mozesz wybrac cos innego z karty.',
                menuItems: menuItemsForAssistant,
                menu: preview.menu,
                restaurants: [],
                restaurant,
                contextUpdates: {
                    ...baseContextUpdates,
                    last_menu: preview.menu,
                    last_menu_restaurant_id: restaurant.id,
                },
                meta: {
                    source: 'db_menu_focus',
                    menuScope: 'full_menu',
                    menuPresentationMode: focusResult.focusedMenuItemId ? 'discovery' : 'full',
                    focusedMenuItemId: focusResult.focusedMenuItemId,
                    menuFocusQuery: focusResult.query.kind,
                },
            };
        }

        const menuSummary = buildNaturalMenuReplySummary(preview.menu);
        const intro = `Wybrano restauracje ${restaurant.name}.`;
        const closing = menuSummary.followUpQuestion;
        const reply = `${intro} ${menuSummary.summaryLine} ${closing}`;

        console.log(`MenuHandler: showing ${shown}/${count} items for ${restaurant.name} (assistant_scope=full_menu)`);

        return {
            intent: 'menu_request',
            reply,
            closing_question: closing,
            // In target restaurant scope, assistant must see full menu for reliable dish resolution.
            menuItems: menuItemsForAssistant,
            menu: preview.menu, // Full menu for UI rendering
            restaurants: [],
            restaurant,
            contextUpdates: {
                ...baseContextUpdates,
                // Store FULL menu in context to support downstream dish matching.
                last_menu: preview.menu,
                last_menu_restaurant_id: restaurant.id,
            },
            meta: {
                source: 'db',
                menuScope: 'full_menu',
                menuPresentationMode: 'full',
            },
        };
    }
}
