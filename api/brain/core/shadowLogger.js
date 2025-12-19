/**
 * Logowanie wyników porównania Brain V1 vs V2 (Shadow Mode)
 */
import { supabase } from '../../_supabase.js';

export async function logShadowComparison({ sessionId, text, legacy, v2 }) {
    if (process.env.NODE_ENV === 'test') return;

    try {
        const match = legacy.intent === v2.intent;
        const latencyDiff = (v2.meta?.latency_ms || 0) - (legacy.meta?.latency_ms || 0);

        console.log(`[ShadowMode] ${match ? '✅' : '❌'} Match: ${legacy.intent} vs ${v2.intent} (V2 Latency: ${v2.meta?.latency_ms}ms)`);

        // Zapisz do bazy (używamy istniejącej tabeli amber_intents lub dedykowanej)
        // Dla uproszczenia (i braku migracji) używamy console.log + ewentualnie event log
        // W produkcji dodalibyśmy tabelę 'brain_shadow_logs'

        // Persist to 'amber_intents' for Admin Panel analytics
        // We use a special structure to distinguish shadow logs
        await supabase.from('amber_intents').insert({
            intent: `SHADOW_V2:${v2.intent}`, // Prefix to easily filter
            reply: JSON.stringify({
                shadow_mode: true,
                input: text,
                legacy_intent: legacy.intent,
                v2_intent: v2.intent,
                match: match,
                latency_v2: v2.meta?.latency_ms,
                latency_legacy: legacy.meta?.latency_ms,
                nlu_source: v2.meta?.nlu_source
            }),
            duration_ms: v2.meta?.latency_ms || 0,
            confidence: match ? 1.0 : 0.0, // 0.0 confidence signals mismatch
            fallback: !match,
            // Reuse existing columns
            nlu_ms: 0,
            db_ms: 0,
            tts_ms: 0
        });

    } catch (err) {
        console.warn('⚠️ Shadow logger error:', err.message);
    }
}
