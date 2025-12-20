/* backend/utils/logger.js */

const LOG_TAGS = {
    NLU: '[NLU]',
    PIPELINE: '[PIPELINE]',
    SESSION: '[SESSION]',
    HANDLER: (name) => `[HANDLER:${name}]`
};

/**
 * Standardized Logger for Brain Debugging
 * Usage:
 * import { BrainLogger } from "./utils/logger.js";
 * BrainLogger.nlu("Matched intent:", "food.find");
 */
export const BrainLogger = {
    /**
     * Internal safe log
     */
    _log: (tag, ...args) => {
        if (global.BRAIN_DEBUG) {
            // Use console.log for now, can be upgraded to coloring libraries later
            console.log(tag, ...args);
        }
    },

    /**
     * Log NLU events (Intent detection, entities, scoring)
     */
    nlu: (...args) => BrainLogger._log(LOG_TAGS.NLU, ...args),

    /**
     * Log Pipeline events (Orchestration, flow control)
     */
    pipeline: (...args) => BrainLogger._log(LOG_TAGS.PIPELINE, ...args),

    /**
     * Log Session events (State changes, context updates)
     */
    session: (...args) => BrainLogger._log(LOG_TAGS.SESSION, ...args),

    /**
     * Log Handler specific events
     * @param {string} handlerName - Name of the handler e.g. 'food.find'
     * @param {...any} args - Log messages
     */
    handler: (handlerName, ...args) => BrainLogger._log(LOG_TAGS.HANDLER(handlerName), ...args),

    /**
     * Raw log for general brain debug
     */
    debug: (...args) => {
        if (global.BRAIN_DEBUG) {
            console.log('[BRAIN]', ...args);
        }
    }
};
