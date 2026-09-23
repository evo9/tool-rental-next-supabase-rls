import type { CustomerCategory } from './types';

export const CUSTOMER_PHOTOS_BUCKET = 'customer-photos';

/** Срок жизни signed URL в секундах: хватает на отрисовку страницы. */
export const PHOTO_URL_TTL = 60;

export const PHOTO_MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

export const CATEGORY_LABELS: Record<CustomerCategory, string> = {
    PLATINUM: 'Platinum',
    GOLD: 'Gold',
    SILVER: 'Silver',
    NON_GRATA: 'Non grata',
};