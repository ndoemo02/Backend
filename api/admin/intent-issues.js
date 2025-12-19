
import { supabase } from "../_supabase.js";

export default async function handler(req, res) {
    if (req.method !== "GET") {
        return res.status(405).json({ error: "method_not_allowed" });
    }

    const { data, error } = await supabase
        .from("intent_issues")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);

    if (error) {
        return res.status(500).json({ error: error.message });
    }

    res.json({ ok: true, issues: data });
}
