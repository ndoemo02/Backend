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

// ═══════════════════════════════════════════════════════════════════════════
// BARGE-IN CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a barge-in controller for TTS playback
 * Use abort() when user starts speaking to stop TTS immediately
 * 
 * @returns {{ abort: () => void, signal: AbortSignal, isAborted: () => boolean }}
 */
export function createBargeInController() {
    const controller = new AbortController();

    return {
        abort: () => controller.abort(),
        signal: controller.signal,
        isAborted: () => controller.signal.aborted
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// STREAMING ITERATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chunk structure for streaming
 * @typedef {Object} TtsChunk
 * @property {number} index - Chunk index (0-based)
 * @property {string} text - Chunk text
 * @property {boolean} isFirst - Is this the first chunk
 * @property {boolean} isLast - Is this the last chunk
 * @property {number} pauseAfter - Pause in ms after chunk
 */

/**
 * Create an async iterator for streaming chunks
 * Supports barge-in cancellation via AbortSignal
 * 
 * @param {string} text - Full response text
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Abort signal for barge-in
 * @param {boolean} [options.polish=true] - Polish text before chunking
 * @returns {AsyncGenerator<TtsChunk>}
 */
export async function* streamChunks(text, options = {}) {
    const { signal, polish = true } = options;
    const { chunks, pacing } = processForTTS(text, { polish });

    for (let i = 0; i < chunks.length; i++) {
        // Check for barge-in
        if (signal?.aborted) {
            console.log('[TtsChunker] Barge-in detected, stopping stream');
            return;
        }

        const chunk = {
            index: i,
            text: chunks[i],
            isFirst: i === 0,
            isLast: i === chunks.length - 1,
            pauseAfter: i === chunks.length - 1 ? 0 : pacing.pauseBetweenChunks
        };

        yield chunk;

        // Pause between chunks (except last)
        if (!chunk.isLast && chunk.pauseAfter > 0) {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(resolve, getNaturalPause(chunk.pauseAfter, pacing.pauseVariation));

                // Cancel on abort
                if (signal) {
                    const abortHandler = () => {
                        clearTimeout(timeout);
                        reject(new Error('Aborted'));
                    };
                    signal.addEventListener('abort', abortHandler, { once: true });
                }
            }).catch(() => {
                // Aborted - stop iteration
                return;
            });
        }
    }
}

/**
 * Get first chunk for immediate playback
 * 
 * @param {string} text - Full response text
 * @param {Object} [options]
 * @param {boolean} [options.polish=true] - Polish text before chunking
 * @returns {{ chunk: TtsChunk | null, remaining: TtsChunk[] }}
 */
export function getFirstChunk(text, options = {}) {
    const { polish = true } = options;
    const { chunks, pacing } = processForTTS(text, { polish });

    if (chunks.length === 0) {
        return { chunk: null, remaining: [] };
    }

    const ttsChunks = chunks.map((chunkText, i) => ({
        index: i,
        text: chunkText,
        isFirst: i === 0,
        isLast: i === chunks.length - 1,
        pauseAfter: i === chunks.length - 1 ? 0 : pacing.pauseBetweenChunks
    }));

    return {
        chunk: ttsChunks[0],
        remaining: ttsChunks.slice(1)
    };
}

/**
 * Estimate TTS duration for text (rough)
 * @param {string} text
 * @param {number} [wordsPerMinute=150] - Average speaking rate
 * @returns {number} - Duration in milliseconds
 */
export function estimateDuration(text, wordsPerMinute = 150) {
    if (!text) return 0;

    const wordCount = text.split(/\s+/).length;
    const minutes = wordCount / wordsPerMinute;

    return Math.round(minutes * 60 * 1000);
}
