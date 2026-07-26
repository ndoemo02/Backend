
import { getSession, updateSession } from '../../session/sessionStore.js';
import { fuzzyMatch } from '../../helpers.js';
import { resolveRestaurantByName } from '../../services/restaurantResolver.js';

export class SelectRestaurantHandler {

    async execute(ctx) {
        const { text, session } = ctx;
        console.log(`🧠 SelectRestaurantHandler executing... Pending Dish: "${session?.pendingDish}"`);

        // UX Guard 3: If currentRestaurant already set and user confirms same restaurant
        // Skip re-selection, go directly to menu/order prompt
        if (session?.currentRestaurant && ctx.body?.meta?.ui_action?.type !== 'select_restaurant') {
            const currentName = session.currentRestaurant.name?.toLowerCase() || '';
            const inputLower = text.toLowerCase();

            // Check if user is confirming or mentioning current restaurant
            if (fuzzyMatch(currentName, inputLower) || inputLower.includes(currentName.substring(0, 5))) {
                console.log(`✨ UX Guard 3: Already at ${session.currentRestaurant.name}, skipping re-selection.`);
                return {
                    reply: `Jesteś już w ${session.currentRestaurant.name}. Co chcesz zamówić?`,
                    contextUpdates: {
                        expectedContext: 'create_order'
                    },
                    meta: { source: 'already_at_restaurant' }
                };
            }
        }

        const { entities } = ctx;

        // 🔥 Direct entity selection (when NLU resolved restaurantId via catalog match)
        // Fixes the NLU→Handler communication gap: router knows the restaurant,
        // handler was falling through to session list lookup and failing.
        if (entities?.restaurantId) {
            console.log(`🟢 SelectHandler: direct entity match → ${entities.restaurant} (id=${entities.restaurantId})`);

            const currentRestaurant = {
                id: entities.restaurantId,
                name: entities.restaurant,
                city: entities.location || null
            };

            // 🛡️ RE-SELECTION SAFETY GUARD (Direct match conflict)
            const conflict = this._checkCartConflict(session, currentRestaurant, ctx);
            if (conflict) {
                return conflict;
            }

            // Auto-show menu after selection
            ctx.session = {
                ...ctx.session,
                lastRestaurant: currentRestaurant,
                currentRestaurant: currentRestaurant,
                last_menu: null,
                last_menu_restaurant_id: null
            };

            const { MenuHandler } = await import('./menuHandler.js');
            const menuHandler = new MenuHandler();
            const menuResponse = await menuHandler.execute(ctx);

            let finalReply = `Wybrano ${entities.restaurant}. `;
            if (menuResponse.reply) {
                finalReply += menuResponse.reply.replace(`Wybrano restaurację ${entities.restaurant}. `, '').replace(`Wybrano restaurację ${entities.restaurant}.`, '');
            }

            return {
                ...menuResponse,
                reply: finalReply,
                contextUpdates: {
                    ...menuResponse.contextUpdates,
                    currentRestaurant,
                    lastRestaurant: currentRestaurant,
                    lockedRestaurantId: entities.restaurantId,
                    awaiting: null,
                    cart: { items: [], total: 0, restaurantId: entities.restaurantId },
                    pendingOrder: null,
                    conversationPhase: 'ordering',
                    expectedContext: 'create_order',
                },
                meta: { source: 'entity_direct_selection_auto_menu' }
            };
        }

        // NAME-ONLY RESOLUTION: Gemini passed restaurant_name but no restaurant_id.
        // Try to resolve to {id, name} via entity cache or DB before falling to list lookup.
        if (entities?.restaurant && !entities?.restaurantId) {
            const resolved = await resolveRestaurantByName(
                entities.restaurant,
                session?.entityCache?.restaurants
            );
            if (resolved?.id) {
                console.log(`[SELECT_NAME_RESOLVE] resolved "${entities.restaurant}" → id=${resolved.id}`);
                // Re-enter the direct entity path with the resolved ID
                const currentRestaurant = {
                    id: resolved.id,
                    name: resolved.name,
                    city: entities.location || null,
                };

                const conflict = this._checkCartConflict(session, currentRestaurant, ctx);
                if (conflict) return conflict;

                ctx.session = {
                    ...ctx.session,
                    lastRestaurant: currentRestaurant,
                    currentRestaurant: currentRestaurant,
                    last_menu: null,
                    last_menu_restaurant_id: null,
                };

                const { MenuHandler } = await import('./menuHandler.js');
                const menuHandler = new MenuHandler();
                const menuResponse = await menuHandler.execute(ctx);

                let finalReply = `Wybrano ${resolved.name}. `;
                if (menuResponse.reply) {
                    finalReply += menuResponse.reply
                        .replace(`Wybrano restaurację ${resolved.name}. `, '')
                        .replace(`Wybrano restaurację ${resolved.name}.`, '');
                }

                return {
                    ...menuResponse,
                    reply: finalReply,
                    contextUpdates: {
                        ...menuResponse.contextUpdates,
                        currentRestaurant,
                        lastRestaurant: currentRestaurant,
                        lockedRestaurantId: resolved.id,
                        awaiting: null,
                        cart: { items: [], total: 0, restaurantId: resolved.id },
                        pendingOrder: null,
                        conversationPhase: 'ordering',
                        expectedContext: 'create_order',
                    },
                    meta: { source: 'select_name_resolved_auto_menu' },
                };
            }
            // Name could not be resolved — fall through to list / ask
            console.log(`[SELECT_NAME_RESOLVE] unresolved name="${entities.restaurant}" — falling through to list`);
        }

        const list = session?.last_restaurants_list || [];
        if (!list || list.length === 0) {
            // UX: If we have currentRestaurant but no list, use current
            if (session?.currentRestaurant) {
                return {
                    reply: `Jesteś już w ${session.currentRestaurant.name}. Co chcesz zamówić?`,
                    contextUpdates: { expectedContext: 'create_order' }
                };
            }
            // No list and no current restaurant → ask to narrow down, but NO reset
            return {
                reply: "Nie mam listy restauracji do wyboru. Czy możesz podać nazwę restauracji lub powiedz 'znajdź restaurację'?",
                contextUpdates: { expectedContext: 'select_restaurant' }
            };
        }

        let selected = null;

        // 1. Try numeric digit detection (e.g. "3", "wybieram 3")
        const numMatch = text.match(/\b(\d+)\b/);
        if (numMatch) {
            const idx = parseInt(numMatch[1], 10) - 1; // 1-based to 0-based
            if (idx >= 0 && idx < list.length) {
                selected = list[idx];
                console.log(`🟢 SelectHandler: numeric digit "${numMatch[1]}" → ${selected.name}`);
            }
        }

        // 2. Try Polish ordinal / number word mapping (1-10)
        if (!selected) {
            const POLISH_ORDINALS = {
                'jeden': 1, 'jedynka': 1, 'pierwsza': 1, 'pierwszy': 1, 'pierwsze': 1,
                'dwa': 2, 'dwojka': 2, 'druga': 2, 'drugi': 2, 'drugie': 2,
                'trzy': 3, 'trojka': 3, 'trzecia': 3, 'trzeci': 3, 'trzecie': 3,
                'cztery': 4, 'czworka': 4, 'czwarta': 4, 'czwarty': 4, 'czwarte': 4,
                'piec': 5, 'piatka': 5, 'piata': 5, 'piaty': 5, 'piate': 5,
                'szesc': 6, 'szostka': 6, 'szosta': 6, 'szosty': 6, 'szoste': 6,
                'siedem': 7, 'siodemka': 7, 'siodma': 7, 'siodmy': 7, 'siodme': 7,
                'osiem': 8, 'osemka': 8, 'osma': 8, 'osmy': 8, 'osme': 8,
                'dziewiec': 9, 'dziewiatka': 9, 'dziewiata': 9, 'dziewiaty': 9, 'dziewiate': 9,
                'dziesiec': 10, 'dziesiatka': 10, 'dziesiata': 10, 'dziesiaty': 10, 'dziesiate': 10
            };

            const normalizedText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Split into words, removing punctuation
            const words = normalizedText.replace(/[^\w\s]/g, '').split(/\s+/);

            for (const word of words) {
                if (POLISH_ORDINALS[word]) {
                    const idx = POLISH_ORDINALS[word] - 1;
                    if (idx >= 0 && idx < list.length) {
                        selected = list[idx];
                        console.log(`🟢 SelectHandler: ordinal word "${word}" → ${selected.name}`);
                        break;
                    }
                }
            }
        }

        // 3. Try simple name fragment matching using `includes()`
        if (!selected) {
            const cleanText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            // Remove common filler words to extract the likely restaurant fragment
            const queryWords = cleanText.replace(/\b(wybieram|chce|wezme|poprosze|ta|to|ten)\b/g, '').trim();

            if (queryWords.length > 0) {
                for (const r of list) {
                    const rName = r.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
                    // Match if user's fragment is in the name, or name is in user's phrase
                    if (rName.includes(queryWords) || queryWords.includes(rName)) {
                        selected = r;
                        console.log(`🟢 SelectHandler: fragment match "${queryWords}" → ${selected.name}`);
                        break;
                    }
                }
            }
        }

        if (!selected) {
            return {
                reply: `Nie wiem którą restaurację z listy masz na myśli. Wybierz numer od 1 do ${list.length} lub powiedz "cofnij".`,
                contextUpdates: {
                    expectedContext: null,
                },
            };
        }

        // 🛡️ RE-SELECTION SAFETY GUARD (Conflict with active cart in ordering phase)
        const conflict = this._checkCartConflict(session, selected, ctx);
        if (conflict) {
            return conflict;
        }

        // 3. Selection Success
        // Build currentRestaurant object for persistence — keep full data (image_url, photo_gallery etc.)
        const currentRestaurant = {
            ...selected,
            id: selected.id,
            name: selected.name,
            city: selected.city || null,
        };

        // Feature: Auto-convert to order if we have a pending dish remembered
        if (session?.pendingDish) {
            const dishName = session.pendingDish;
            return {
                reply: `Wybrano ${selected.name}. Rozpoczynam zamawianie: ${dishName}. Coś jeszcze?`,
                should_reply: true,
                actions: [
                    {
                        type: 'create_order',
                        payload: {
                            restaurant: selected,
                            restaurant_id: selected.id,
                            items: [{ name: dishName, quantity: 1 }]
                        }
                    }
                ],
                contextUpdates: {
                    currentRestaurant, // NEW: Persistent restaurant
                    lastRestaurant: selected,
                    lockedRestaurantId: selected.id,
                    awaiting: null,
                    cart: { items: [], total: 0, restaurantId: selected.id },
                    pendingOrder: null,
                    pendingDish: null,
                },
                meta: { source: 'selection_auto_order' }
            };
        }

        // Auto-show menu after selection
        ctx.session = {
            ...ctx.session,
            lastRestaurant: selected,
            currentRestaurant: currentRestaurant,
            last_menu: null,
            last_menu_restaurant_id: null
        };

        // Import MenuHandler dynamically to avoid circular dependency issues if any
        const { MenuHandler } = await import('./menuHandler.js');
        const menuHandler = new MenuHandler();
        const menuResponse = await menuHandler.execute(ctx);

        let finalReply = `Wybrano ${selected.name}. `;
        if (menuResponse.reply) {
            finalReply += menuResponse.reply.replace(`Wybrano restaurację ${selected.name}. `, '').replace(`Wybrano restaurację ${selected.name}.`, '');
        }

        return {
            ...menuResponse,
            reply: finalReply,
            contextUpdates: {
                ...menuResponse.contextUpdates,
                currentRestaurant,
                lastRestaurant: selected,
                lockedRestaurantId: selected.id,
                awaiting: null,
                cart: { items: [], total: 0, restaurantId: selected.id },
                pendingOrder: null,
                conversationPhase: 'ordering',
                expectedContext: 'create_order',
            },
            meta: {
                source: 'selection_auto_menu',
                debug_cart: ctx.body?.meta?.state?.cart || session?.cart
            }
        };
    }

    /**
     * Helper to check if user is trying to switch restaurants while having items in cart.
     */
    _checkCartConflict(session, selected, ctx) {
        // Bypass if forceSwitch is set (user already confirmed)
        if (ctx.entities?.forceSwitch === true) return null;

        const cart = ctx.body?.meta?.state?.cart || session?.cart;
        const hasCartItems = cart?.items?.length > 0;

        // Use cart.restaurantId to determine original restaurant, fallback to session.currentRestaurant
        const cartRestaurantId = cart?.restaurantId || session?.currentRestaurant?.id;
        const isDifferentRestaurant = cartRestaurantId && cartRestaurantId !== selected.id;

        console.log(`[DEBUG] _checkCartConflict: hasCartItems=${hasCartItems}, cartRestaurantId=${cartRestaurantId}, selected.id=${selected.id}`);

        // If cart has items and they belong to a different restaurant, raise conflict
        if (hasCartItems && isDifferentRestaurant) {
            // Resolve source name: cart item metadata first, then session.currentRestaurant
            const oldRestaurantName =
                cart?.items?.[0]?.restaurant_name ||
                session?.currentRestaurant?.name ||
                'innej restauracji';
            console.log(`🛡️ SelectHandler: Restaurant switch conflict detected! Current: ${oldRestaurantName}, Target: ${selected.name}`);
            return {
                reply: `Masz już pozycje z ${oldRestaurantName}. Czy wyczyścić koszyk i przejść do ${selected.name}?`,
                contextUpdates: {
                    expectedContext: 'confirm_restaurant_switch',
                    pendingRestaurantSwitch: {
                        id: selected.id,
                        name: selected.name,
                        city: selected.city || null
                    }
                },
                meta: { source: 'restaurant_switch_conflict' }
            };
        }
        return null;
    }
}
