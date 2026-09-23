import type { RentalStatus, ToolUnitStatus } from './types';

export const RENTAL_PHOTOS_BUCKET = 'rental-photos';

/** Срок жизни signed URL в секундах: хватает на отрисовку страницы. */
export const PHOTO_URL_TTL = 60;

export const PHOTO_MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
};

export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
    ACTIVE: 'Active',
    CLOSED: 'Closed',
};

export const TOOL_UNIT_STATUS_LABELS: Record<ToolUnitStatus, string> = {
    AVAILABLE: 'Available',
    RENTED: 'Rented',
    UNAVAILABLE: 'Unavailable',
    WRITTEN_OFF: 'Written off',
};
