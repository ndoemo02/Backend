
import { supabase } from '../../_supabase.js';

/**
 * Logs a brain event to Supabase.
 * @param {Object} event
 * @param {string} event.sessionId
 * @param {string} event.text
 * @param {string} event.normalizedText
 * @param {string} event.intent
 * @param {number} - event.confidence
 * @param {boolean} event.isFallback
 * @param {string} [event.restaurantId]
 * @param {string} [event.errorCode]
 */
export async function logBrainEvent(event) {
    try {
        const payload = {
            session_id: event.sessionId,
            user_text: event.text,
            normalized_text: event.normalizedText,
            intent: event.intent,
            confidence: typeof event.confidence === 'number' ? event.confidence : 0,
            is_fallback: event.isFallback,
            restaurant_id: event.restaurantId || null,
            error_code: event.errorCode || null
        };

        // Fire and forget - insert into brain_logs
        supabase.from('brain_logs').insert(payload).then(({ error }) => {
            if (error) console.warn('⚠️ Brain logger insert failed:', error.message);
        }).catch(err => {
            console.warn('⚠️ Brain logger exception:', err.message);
        });

    } catch (e) {
        console.warn('⚠️ Logger wrapper logic failed:', e.message);
    }
}
