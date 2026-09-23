// crypto.randomUUID() есть только в защищённом контексте (HTTPS или localhost).
// При тесте с телефона по http://<LAN-IP> его нет, getRandomValues доступен всегда.
// Первое использование - src/features/customers/upload.ts (этап 3); второе -
// src/features/rentals/upload.ts (этап 4), поэтому вынесено сюда.
export function randomName(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
