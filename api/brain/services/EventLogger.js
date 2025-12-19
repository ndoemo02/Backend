import { supabase } from '../../_supabase.js';

export const EventLogger = {
    // Loguje start/aktualizację rozmowy
    // Loguje start/aktualizację rozmowy
    async logConversation(sessionId, metadata = {}, status = 'active') {
        if (process.env.NODE_ENV === 'test') return;
        try {
            const updates = {
                id: sessionId,
                metadata,
                status,
                updated_at: new Date().toISOString()
            };

            // Jeśli zamykamy/błądujemy sesję, ustaw ended_at
            if (status !== 'active') {
                updates.ended_at = new Date().toISOString();
            } else {
                // Dla active nie ruszamy ended_at (chyba że resetujemy - ale tu upsert)
                // W upsert lepiej nie nadpisywać ended_at NULLem jeśli już było, ale w sumie active = not ended.
                updates.ended_at = null;
            }

            // Ale uwaga: Jeśli sesja już istnieje i jest active, upsert z ended_at=null jest ok.
            // Jeśli była closed i robimy active (resume?), to ended_at=null jest ok.

            const { error } = await supabase.from('conversations').upsert(updates, { onConflict: 'id' });

            if (error) console.warn('⚠️ Log Conversation Error:', error.message);
        } catch (e) {
            console.warn('⚠️ Log Conversation Exception:', e.message);
        }
    },

    // Loguje konkretne zdarzenie
    async logEvent(sessionId, eventType, payload, confidence = null, workflowStep = null, eventStatus = 'success') {
        if (process.env.NODE_ENV === 'test') return;
        try {
            // Używamy await, aby upewnić się, że request wyjdzie przed zamknięciem procesu
            const { error } = await supabase.from('conversation_events').insert({
                conversation_id: sessionId,
                event_type: eventType,
                payload: payload || {},
                confidence,
                workflow_step: workflowStep,
                event_status: eventStatus,
                created_at: new Date().toISOString()
            });

            if (error) {
                // Jeśli błąd FK (brak conversations), spróbuj utworzyć conversations i ponów
                if (error.code === '23503') { // foreign_key_violation
                    await EventLogger.logConversation(sessionId);
                    await supabase.from('conversation_events').insert({
                        conversation_id: sessionId,
                        event_type: eventType,
                        payload: payload || {},
                        confidence,
                        workflow_step: workflowStep,
                        event_status: eventStatus,
                        created_at: new Date().toISOString()
                    });
                } else {
                    if (!error.message.includes('relation "conversation_events" does not exist')) {
                        console.warn(`⚠️ Event Log Error (${eventType}):`, error.message);
                    }
                }
            }
        } catch (e) {
            console.warn('⚠️ Log Event Exception:', e);
        }
    }
};
