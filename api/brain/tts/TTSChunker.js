/**
 * TTSChunker.js
 * 
 * Human-like TTS processing:
 * - Sentence-based chunking (max ~120 chars)
 * - Pre-TTS text polishing (NO LLM)
 * - Natural pacing parameters
 * 
 * ❌ NO LLM calls
 * ✅ Pure deterministic processing
 */

// ═══════════════════════════════════════════════════════════════════════════
// SENTENCE SPLITTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Split text into speakable chunks based on sentence boundaries
 * @param {string} text - Text to split
 * @param {number} maxLen - Maximum characters per chunk (default 120)
 * @returns {string[]} Array of chunks
 */
export function splitIntoChunks(text, maxLen = 120) {
    if (!text || typeof text !== 'string') {
        return [];
    }

    // Split by sentence-ending punctuation
    // Using match instead of lookbehind for compatibility
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks = [];
    let current = '';

    for (const sentence of sentences) {
        const combined = current ? current + ' ' + sentence : sentence;
        
        if (combined.length > maxLen && current) {
            // Current chunk is full, push it
            chunks.push(current.trim());
            current = sentence;
        } else {
            current = combined;
        }
    }

    // Don't forget the last chunk
    if (current.trim()) {
        chunks.push(current.trim());
    }

    return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRE-TTS TEXT POLISHING (NO LLM)
// ═══════════════════════════════════════════════════════════════════════════

const POLISH_ORDINALS = [
    '', 
    'Po pierwsze', 
    'Po drugie', 
    'Po trzecie', 
    'Po czwarte', 
    'Po piąte',
    'Po szóste',
    'Po siódme',
    'Po ósme',
    'Po dziewiąte',
    'Po dziesiąte'
];

/**
 * Convert number to Polish ordinal phrase
 */
function toOrdinalPolish(n) {
    const num = parseInt(n, 10);
    if (num >= 1 && num <= 10) {
        return POLISH_ORDINALS[num];
    }
    return `Punkt ${n}`;
}

/**
 * Polish text for natural speech (NO LLM)
 * - Convert numbered lists to spoken ordinals
 * - Remove visual formatting
 * - Normalize whitespace
 * 
 * @param {string} text - Raw text
 * @returns {string} Polished text
 */
export function polishForSpeech(text) {
    if (!text || typeof text !== 'string') {
        return text || '';
    }

    let result = text;

    // Convert "1." → "Po pierwsze," etc.
    result = result.replace(/^(\d+)\.\s+/gm, (_, n) => toOrdinalPolish(n) + ', ');
    // Match " 2." pattern without lookbehind
    result = result.replace(/(\s)(\d+)\.\s+/g, (_, space, n) => space + toOrdinalPolish(n) + ', ');

    // Remove markdown-style formatting
    result = result.replace(/\*\*([^*]+)\*\*/g, '$1');  // **bold** → bold
    result = result.replace(/\*([^*]+)\*/g, '$1');      // *italic* → italic
    result = result.replace(/_([^_]+)_/g, '$1');        // _underline_ → underline
    
    // Convert dashes to natural pauses
    result = result.replace(/\s*–\s*/g, ', ');
    result = result.replace(/\s*—\s*/g, ', ');
    
    // Normalize multiple spaces
    result = result.replace(/\s+/g, ' ');

    // Clean up double commas
    result = result.replace(/,\s*,/g, ',');

    return result.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// TTS PACING PARAMETERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Default pacing for human-like speech
 */
export const DEFAULT_PACING = {
    rate: 0.95,           // Slightly slower than default
    pitch: -0.5,          // Slightly lower for Polish
    pauseBetweenChunks: 300,  // 300ms between chunks
    pauseVariation: 100       // ±100ms random variation
};

/**
 * Get natural pause duration with slight randomness
 */
export function getNaturalPause(basePause = 300, variation = 100) {
    return basePause + (Math.random() * variation * 2 - variation);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PROCESSING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process text for human-like TTS
 * @param {string} text - Raw text
 * @param {object} options - { maxChunkLen, polish }
 * @returns {{ chunks: string[], pacing: object }}
 */
export function processForTTS(text, options = {}) {
    const { maxChunkLen = 120, polish = true } = options;

    // Step 1: Polish if enabled
    const polished = polish ? polishForSpeech(text) : text;

    // Step 2: Split into chunks
    const chunks = splitIntoChunks(polished, maxChunkLen);

    return {
        chunks,
        pacing: DEFAULT_PACING,
        originalLength: text?.length || 0,
        processedLength: polished?.length || 0,
        chunkCount: chunks.length
    };
}
