import 'server-only';
import { headers } from 'next/headers';
import QRCode from 'qrcode';

/**
 * Базовый адрес приложения для ссылки в QR. NEXT_PUBLIC_APP_URL, если задан;
 * иначе адрес, по которому сейчас открыта страница (заголовки запроса).
 * Для наклейки, которую сканируют телефоном, адрес должен быть достижим с
 * телефона: `localhost` на компьютере разработчика не откроется, в dev с
 * телефона нужен адрес в локальной сети (http://<IP>:3000, тот же, что в
 * allowedDevOrigins). Подробно: docs/book/07-dashboard-import-qr.md.
 */
async function getAppUrl(): Promise<string> {
    const fromEnv = process.env.NEXT_PUBLIC_APP_URL;
    if (fromEnv) return fromEnv.replace(/\/+$/, '');

    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host');
    if (!host) throw new Error('Set NEXT_PUBLIC_APP_URL: cannot work out the application address.');
    const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
    return `${proto}://${host}`;
}

/**
 * SVG-разметка QR-кода с адресом карточки единицы. В коде id, а не
 * инвентарный номер: URL открывает любая камера телефона без отдельного
 * сканера, а номер можно исправить после печати наклейки. Генерация на
 * сервере: в браузер уходит готовая разметка, клиентская библиотека не нужна.
 * Строка вставляется через dangerouslySetInnerHTML - её целиком строит
 * qrcode из адреса и uuid, пользовательского текста в ней нет.
 */
export async function unitQrSvg(unitId: string): Promise<string> {
    const url = `${await getAppUrl()}/units/${unitId}`;
    return QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' });
}
