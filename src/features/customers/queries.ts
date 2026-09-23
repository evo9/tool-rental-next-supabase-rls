import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { CUSTOMER_PHOTOS_BUCKET, PHOTO_URL_TTL } from './constants';

export async function listCustomers(q?: string) {
    const supabase = await createClient();

    let query = supabase
        .from('customers')
        .select('id, full_name, phone, category, created_at')
        .order('created_at', { ascending: false })
        .limit(50);

    const term = q?.trim();
    if (term) {
        // Похоже на телефон - ищем по цифрам, иначе по имени.
        query = /^[\d\s()+-]+$/.test(term)
            ? query.ilike('phone', `%${term.replace(/\D/g, '')}%`)
            : query.ilike('full_name', `%${term}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function getCustomerWithPhotos(id: string) {
    const supabase = await createClient();

    const { data: customer, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    // 22P02: в URL не uuid. Для пользователя это та же "не найдено".
    if (error?.code === '22P02') return null;
    if (error) throw error;
    if (!customer) return null;

    const paths = [customer.photo_path, customer.document_photo_path].filter(
        (p): p is string => p !== null,
    );

    // Подпись создаётся сессионным клиентом: Storage проверит SELECT-политику
    // на storage.objects для этого пользователя.
    const urls = new Map<string, string>();
    if (paths.length > 0) {
        const { data } = await supabase.storage
            .from(CUSTOMER_PHOTOS_BUCKET)
            .createSignedUrls(paths, PHOTO_URL_TTL);
        for (const item of data ?? []) {
            if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
        }
    }

    return {
        customer,
        photoUrl: customer.photo_path ? urls.get(customer.photo_path) ?? null : null,
        documentUrl: customer.document_photo_path
            ? urls.get(customer.document_photo_path) ?? null
            : null,
    };
}