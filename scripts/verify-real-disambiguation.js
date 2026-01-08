
import 'dotenv/config';
import { resolveMenuItemConflict, DISAMBIGUATION_RESULT } from '../api/brain/services/DisambiguationService.js';

async function verifyRealData() {
    console.log("🔍 Weryfikacja DisambiguationService (REAL DB) v2...\n");

    const queries = ["woda", "pizza", "zupa pomidorowa"];

    for (const query of queries) {
        console.log(`\n🧪 SZUKAM: "${query}"`);
        try {
            const result = await resolveMenuItemConflict(query);
            console.log(`   STATUS: ${result.status}`);

            if (result.status === DISAMBIGUATION_RESULT.DISAMBIGUATION_REQUIRED) {
                console.log(`   ⚠️ KOLIZJA! Znaleziono w ${result.candidates.length} restauracjach:`);
                result.candidates.forEach(c => {
                    const rName = c.restaurant ? c.restaurant.name : `ID:${c.items[0].restaurant_id}`;
                    console.log(`     - ${rName} (${c.items.length} items)`);
                });
            } else if (result.status === DISAMBIGUATION_RESULT.ADD_ITEM) {
                console.log(`   ✅ SUKCES! Unikalne (lub auto-resolved). Restauracja: ${result.restaurant.name}`);
                console.log(`      Item: ${result.item.name} (${result.item.price_pln} zł)`);
            } else {
                console.log("   ❌ Nie znaleziono.");
            }
        } catch (err) {
            console.error("   🔥 CRITICAL ERROR:", err);
        }
    }

    process.exit(0);
}

verifyRealData();
