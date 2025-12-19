
import { resolveRestaurantSelectionHybrid } from '../api/brain/restaurant/restaurantSelectionSmart.js';

// Mock session context
const mockSession = {
    lastRestaurants: [
        { index: 1, name: "Stara Kamienica", city: "Piekary Śląskie", id: "1" },
        { index: 2, name: "Rezydencja Luxury Hotel", city: "Piekary Śląskie", id: "2" },
        { index: 3, name: "Klaps Burgers", city: "Piekary Śląskie", id: "3" }
    ],
    lastRestaurantsTimestamp: new Date().toISOString()
};

const examples = [
    "biorę drugą",
    "wybieram 3",
    "poproszę coś z rezydencji",
    "z klapsa",
    "pokaż menu tej pierwszej",
    "ta numer dwa",
    "coś ze starej kamienicy"
];

async function runTests() {
    console.log("🚀 Hybrid Restaurant Selection Test\n");
    console.table(mockSession.lastRestaurants);
    console.log("\n");

    for (const text of examples) {
        process.stdout.write(`Testing "${text}" ... `);
        const result = await resolveRestaurantSelectionHybrid({
            userText: text,
            sessionContext: mockSession,
            // Mock LLM if needed, or rely on real one if env set
            // For now let's hope heuristics cover most
            logger: { warn: () => { } }
        });

        let out = "NONE";
        if (result.restaurant) {
            out = `[${result.method.toUpperCase()}] ${result.restaurant.name} (Conf: ${result.confidence})`;
        }
        console.log(out);
    }
}

// Force mock LLM behavior if no key? 
// No, existing module handles graceful failure.

runTests();
