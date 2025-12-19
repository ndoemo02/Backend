
import { supabase } from "../../_supabase.js";

export async function logIssue(issue) {
    try {
        await supabase.from("intent_issues").insert({
            session_id: issue.sessionId,
            user_text: issue.userText,
            detected_intent: issue.intent,
            confidence: issue.confidence,
            issue_type: issue.type,
            restaurant_candidates: issue.candidates || null,
            selected_restaurant: issue.selected || null,
            metadata: issue.meta || null
        });
    } catch (err) {
        console.error("❌ Failed to log intent issue:", err);
    }
}
