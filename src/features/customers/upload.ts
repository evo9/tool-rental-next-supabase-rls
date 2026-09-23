import { createClient } from '@/lib/supabase/client';
import { randomName } from '@/lib/random-name';
import { attachCustomerPhotos } from './actions';
import { CUSTOMER_PHOTOS_BUCKET, PHOTO_MIME_TO_EXT } from './constants';

type PhotoKind = 'photo' | 'document';

/** Загружает файл из браузера напрямую в Storage. Возвращает путь в бакете. */
async function uploadCustomerPhoto(customerId: string, kind: PhotoKind, file: File) {
    const ext = PHOTO_MIME_TO_EXT[file.type];
    if (!ext) throw new Error('Only JPEG, PNG, and WebP are supported.');

    // Папка = id клиента: этого требует политика INSERT на storage.objects.
    // Случайное имя: файлы неизменяемые, upsert запрещён политиками.
    const path = `${customerId}/${kind}-${randomName()}.${ext}`;

    const { error } = await createClient()
        .storage
        .from(CUSTOMER_PHOTOS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });

    if (error) throw new Error(error.message);
    return path;
}

/** Загружает выбранные фото и записывает пути в карточку клиента. */
export async function uploadAndAttachPhotos(
    customerId: string,
    files: { photo: File | null; document: File | null },
) {
    const [photoPath, documentPhotoPath] = await Promise.all([
        files.photo ? uploadCustomerPhoto(customerId, 'photo', files.photo) : undefined,
        files.document ? uploadCustomerPhoto(customerId, 'document', files.document) : undefined,
    ]);

    const result = await attachCustomerPhotos(customerId, { photoPath, documentPhotoPath });
    if (!result.ok) throw new Error(result.error);
}