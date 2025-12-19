/**
 * Formatting Utilities
 */

export function pluralPl(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100;
    if (n === 1) return one;
    if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return few;
    return many;
}

export function formatDistance(km) {
    if (km == null || !isFinite(km)) return '';
    if (km < 1) {
        const m = Math.max(1, Math.round(km * 1000));
        return `${m} ${pluralPl(m, 'metr', 'metry', 'metrów')}`;
    }
    const k = Math.round(km * 10) / 10;
    const whole = Math.round(k);
    return `${k} ${pluralPl(whole, 'kilometr', 'kilometry', 'kilometrów')}`;
}
