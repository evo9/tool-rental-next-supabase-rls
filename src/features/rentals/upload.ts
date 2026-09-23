import { createClient } from '@/lib/supabase/client';
import { randomName } from '@/lib/random-name';
import { RENTAL_PHOTOS_BUCKET, PHOTO_MIME_TO_EXT } from './constants';

type PhotoKind = 'issue' | 'return';

/** Загружает фото единицы из браузера напрямую в Storage. Возвращает путь. */
export async function uploadRentalPhoto(
    rentalId: string,
    rentalItemId: string,
    kind: PhotoKind,
    file: File,
): Promise<string> {
    const ext = PHOTO_MIME_TO_EXT[file.type];
    if (!ext) throw new Error('Only JPEG, PNG, and WebP are supported.');

    // Папка = id аренды, затем id позиции: этого требует политика INSERT
    // на storage.objects (глава 04). Случайное имя: файлы неизменяемые,
    // upsert запрещён политиками.
    const path = `${rentalId}/${rentalItemId}/${kind}-${randomName()}.${ext}`;

    const { error } = await createClient()
        .storage
        .from(RENTAL_PHOTOS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

    if (error) throw new Error(error.message);
    return path;
}
