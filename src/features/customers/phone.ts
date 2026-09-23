/**
 * Приводит ввод к E.164 (формат, который требует check в БД).
 * "067 123 45 67", "380671234567", "+380 (67) 123-45-67" -> "+380671234567".
 * Возвращает null, если номер не распознан.
 */
export function normalizePhone(input: string): string | null {
    const raw = input.trim();
    const digits = raw.replace(/\D/g, '');

    if (raw.startsWith('+')) {
        return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
    }
    if (digits.length === 10 && digits.startsWith('0')) return `+38${digits}`;
    if (digits.length === 12 && digits.startsWith('380')) return `+${digits}`;
    return null;
}