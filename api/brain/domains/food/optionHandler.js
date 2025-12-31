/**
 * Food Domain: Option Handler
 * Handles "show more options" and similar listing follow-ups.
 */

export class OptionHandler {
    async execute(ctx) {
        const { session } = ctx;
        const all = session?.last_restaurants_list || [];

        if (!all || !all.length) {
            return {
                reply: "Nie mam więcej opcji do pokazania. Spróbuj zapytać ponownie o restauracje w okolicy.",
            };
        }

        // Tier 4 parity: Show all options
        const list = all.map((r, i) => `${i + 1}. ${r.name}${r.cuisine_type ? ` - ${r.cuisine_type}` : ''}`).join('\n');

        return {
            intent: 'show_more_options',
            reply: `Oto pełna lista opcji:\n${list}\n\nPowiedz numer, np. "1" albo "ta pierwsza".`,
            restaurants: all,
            contextUpdates: {
                expectedContext: 'select_restaurant',
                lastIntent: 'show_more_options'
            }
        };
    }
}
