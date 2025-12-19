/**
 * Domain Dispatcher
 * Kieruje wykryte intencje do odpowiednich Ekspertów Domenowych.
 */

// Import handlers (Lazy loading could be better but imports for now)
import { FindRestaurantHandler } from './food/findHandler.js';
// import { MenuHandler } from './food/menuHandler.js';
// import { OrderHandler } from './food/orderHandler.js';
// import { SystemHandler } from './system/healthHandler.js';

export class DomainDispatcher {
    constructor() {
        this.handlers = {
            'find_nearby': new FindRestaurantHandler(),
            'find_nearby_confirmation': new FindRestaurantHandler(), // Maps to same logic usually
            // 'show_menu': new MenuHandler(),
            // 'create_order': new OrderHandler(),
            // 'system_status': new SystemHandler()
        };
    }

    async dispatch(ctx) {
        const { intent } = ctx;
        const handler = this.handlers[intent];

        if (!handler) {
            console.warn(`No handler for intent: ${intent}`);
            return {
                reply: "Przepraszam, jeszcze nie umiem tego zrobić (brak handlera).",
                fallback: true
            };
        }

        console.log(`🚀 Dispatching ${intent} to ${handler.constructor.name}`);
        return await handler.execute(ctx);
    }
}
