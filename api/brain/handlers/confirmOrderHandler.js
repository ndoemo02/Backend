
import { getSession, updateSession } from "../session/sessionStore.js";
import { commitPendingOrder, sum } from "../session/sessionCart.js";
import { BrainLogger } from "../../../utils/logger.js";

/**
 * ConfirmOrderHandler
 * Handles the logic for confirming a pending order.
 * Ensures strict order: Check -> Execute -> Cleanup.
 * Provides transactional logging.
 */
export async function handleConfirmOrder({ sessionId, text }) {
    BrainLogger.handler('confirm_order', 'Triggered');

    // 1. Retrieve session
    const session = getSession(sessionId) || {};
    const pendingOrder = session.pendingOrder ? JSON.parse(JSON.stringify(session.pendingOrder)) : null;
    const cartBefore = session.cart ? JSON.parse(JSON.stringify(session.cart)) : null;
    // Also capture expectedContext before any potential modification
    const initialContext = session.expectedContext;

    // 2. Transakcyjny check (Validation)
    // Check if we have something to confirm
    const canConfirm = initialContext === 'confirm_order' || !!session.pendingOrder;

    if (!canConfirm) {
        BrainLogger.handler('confirm_order', '⚠️ Nothing to confirm (no pendingOrder/expectedContext)');
        // Not updating session as nothing changed
        return {
            intent: 'confirm_order',
            reply: "Nic do potwierdzenia.",
            meta: { addedToCart: false }
        };
    }

    // 3. Wykonaj akcję (Execute Action)
    // commitPendingOrder modifies session in-place
    const commitResult = commitPendingOrder(session);
    const cartAfter = session.cart ? JSON.parse(JSON.stringify(session.cart)) : {};

    // 4. Cleanup (Cleanup) - TYLKO po sukciesie (committed)
    let clearedKeys = [];
    if (commitResult.committed) {
        // CLEAR CONTEXT explicitly to prevent loops (e.g. restaurant loop)

        // Cleanup 1: Restaurant List
        if (session.last_restaurants_list) {
            session.last_restaurants_list = null;
            clearedKeys.push('last_restaurants_list');
        }

        // Cleanup 2: Follow-up Context (if not already cleared by helper)
        if (session.expectedContext) {
            session.expectedContext = null;
            clearedKeys.push('expectedContext');
        }

        // Cleanup 3: Reset Intent to neutral state
        session.lastIntent = 'order_complete';
        clearedKeys.push('lastIntent->order_complete');
    }

    // 5. Log Transakcyjny (Verification)
    BrainLogger.handler('confirm_order', 'Transaction Log:', {
        sessionId,
        committed: commitResult.committed,
        pendingOrderSnapshot: pendingOrder,
        cartBefore,
        cartAfter,
        cleared: clearedKeys
    });

    // 6. Final Persist
    updateSession(sessionId, session);

    // 7. Prepare Response
    let reply = commitResult.committed ? "Dodano do koszyka. Coś jeszcze?" : "Nic do potwierdzenia.";
    let meta = {
        addedToCart: !!commitResult.committed,
        cart: session.cart
    };

    if (commitResult.committed) {
        const lastOrder = session.lastOrder || {};
        // Handle total calc
        const orderTotal = typeof lastOrder.total === 'number' ? lastOrder.total : Number(sum(lastOrder.items || []));
        meta.parsed_order = { items: lastOrder.items || [], total: orderTotal };
    }

    return {
        intent: 'confirm_order',
        reply,
        meta,
        context: session
    };
}
