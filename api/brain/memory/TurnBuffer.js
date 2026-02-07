/**
 * TurnBuffer.js
 * 
 * Conversational Turn Buffer for Voice Dialog
 * 
 * Purpose: Store last N turns for context resolution
 * Enables: "that one", "the second option", "what did you say"
 * 
 * ❌ Does NOT influence FSM decisions
 * ✅ Read-only for FSM
 * ✅ FIFO queue, max 5 turns
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const MAX_TURNS = 5;

// ═══════════════════════════════════════════════════════════════════════════
// TURN BUFFER MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Turn entry structure
 * @typedef {Object} TurnEntry
 * @property {'user' | 'assistant'} role - Who spoke
 * @property {string} text - What was said
 * @property {string} [surfaceKey] - Dialog surface key (assistant only)
 * @property {Object} [entities] - Extracted entities (items, restaurants, positions)
 * @property {number} timestamp - When the turn occurred
 */

/**
 * Initialize turn buffer on session if not exists
 * @param {Object} session - Session object (mutable)
 */
export function initTurnBuffer(session) {
    if (!session.turnBuffer) {
        session.turnBuffer = [];
    }
}

/**
 * Push a user turn to the buffer
 * @param {Object} session - Session object (mutable)
 * @param {string} text - User's utterance
 * @param {Object} [entities] - Extracted entities
 */
export function pushUserTurn(session, text, entities = null) {
    initTurnBuffer(session);

    const entry = {
        role: 'user',
        text: text,
        entities: entities,
        timestamp: Date.now()
    };

    session.turnBuffer.push(entry);

    // Enforce FIFO limit
    while (session.turnBuffer.length > MAX_TURNS) {
        session.turnBuffer.shift();
    }
}

/**
 * Push an assistant turn to the buffer
 * @param {Object} session - Session object (mutable)
 * @param {string} text - Assistant's response
 * @param {string} [surfaceKey] - Dialog surface key
 * @param {Object} [entities] - Referenced entities in response
 */
export function pushAssistantTurn(session, text, surfaceKey = null, entities = null) {
    initTurnBuffer(session);

    const entry = {
        role: 'assistant',
        text: text,
        surfaceKey: surfaceKey,
        entities: entities,
        timestamp: Date.now()
    };

    session.turnBuffer.push(entry);

    // Enforce FIFO limit
    while (session.turnBuffer.length > MAX_TURNS) {
        session.turnBuffer.shift();
    }
}

/**
 * Get all turns in the buffer (read-only)
 * @param {Object} session - Session object
 * @returns {TurnEntry[]}
 */
export function getTurns(session) {
    return session.turnBuffer ? [...session.turnBuffer] : [];
}

/**
 * Get the last N turns
 * @param {Object} session - Session object
 * @param {number} n - Number of turns to get
 * @returns {TurnEntry[]}
 */
export function getLastTurns(session, n = 3) {
    const buffer = session.turnBuffer || [];
    return buffer.slice(-n);
}

/**
 * Get the last user turn
 * @param {Object} session - Session object
 * @returns {TurnEntry | null}
 */
export function getLastUserTurn(session) {
    const buffer = session.turnBuffer || [];
    for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i].role === 'user') {
            return buffer[i];
        }
    }
    return null;
}

/**
 * Get the last assistant turn
 * @param {Object} session - Session object
 * @returns {TurnEntry | null}
 */
export function getLastAssistantTurn(session) {
    const buffer = session.turnBuffer || [];
    for (let i = buffer.length - 1; i >= 0; i--) {
        if (buffer[i].role === 'assistant') {
            return buffer[i];
        }
    }
    return null;
}

/**
 * Get entities from recent turns (for "that one" resolution)
 * @param {Object} session - Session object
 * @param {string} entityType - Type of entity to find ('restaurant', 'item', etc.)
 * @returns {Object[]} Array of matching entities with their position
 */
export function getRecentEntities(session, entityType) {
    const buffer = session.turnBuffer || [];
    const results = [];

    for (let i = buffer.length - 1; i >= 0; i--) {
        const turn = buffer[i];
        if (turn.entities && turn.entities[entityType]) {
            const entities = Array.isArray(turn.entities[entityType])
                ? turn.entities[entityType]
                : [turn.entities[entityType]];

            entities.forEach((entity, idx) => {
                results.push({
                    ...entity,
                    turnIndex: i,
                    positionInTurn: idx + 1 // 1-indexed for "first", "second"
                });
            });
        }
    }

    return results;
}

/**
 * Clear the turn buffer
 * @param {Object} session - Session object (mutable)
 */
export function clearTurnBuffer(session) {
    session.turnBuffer = [];
}

/**
 * Format turns as context for LLM (read-only)
 * Used by Phrase Generator for natural rephrasing
 * @param {Object} session - Session object
 * @param {number} maxTurns - Maximum turns to include
 * @returns {string} Formatted conversation history
 */
export function formatTurnsForContext(session, maxTurns = 3) {
    const turns = getLastTurns(session, maxTurns);

    if (turns.length === 0) {
        return '';
    }

    return turns.map(turn => {
        const role = turn.role === 'user' ? 'Klient' : 'Asystent';
        return `${role}: ${turn.text}`;
    }).join('\n');
}
