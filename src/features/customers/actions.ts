'use server';

import { createClient } from '@/lib/supabase/server';
import { describeDbError } from '@/lib/db-errors';
import { normalizePhone } from './phone';
import type { ActionResult, CustomerCategory } from './types';

export async function createCustomer(input: {
    fullName: string;
    phone: string;
    category?: CustomerCategory;
}): Promise<ActionResult<{ id: string }>> {
    const fullName = input.fullName.trim();
    const phone = normalizePhone(input.phone);

    if (!fullName) return { ok: false, error: 'Enter a full name.' };
    if (!phone) return { ok: false, error: 'Enter phone as 067 123 45 67 or +380...' };

    // todo !!!это нормально, что мы повсеместно создаем подключение?
    const supabase = await createClient();
    const { data, error } = await supabase
        .from('customers')
        .insert({
            full_name: fullName,
            phone,
            // Категорию передаём, только если её выбрали. Иначе сработает
            // default 'SILVER' в БД. Оператор с другой категорией получит 42501.
            ...(input.category ? { category: input.category } : {}),
        })
        .select('id')
        .single();

    if (error) return { ok: false, error: describeDbError(error) };
    return { ok: true, data: { id: data.id } };
}

export async function attachCustomerPhotos(
    customerId: string,
    paths: { photoPath?: string; documentPhotoPath?: string },
): Promise<ActionResult<null>> {
    const patch: { photo_path?: string; document_photo_path?: string } = {};
    if (paths.photoPath) patch.photo_path = paths.photoPath;
    if (paths.documentPhotoPath) patch.document_photo_path = paths.documentPhotoPath;
    if (Object.keys(patch).length === 0) return { ok: true, data: null };

    const supabase = await createClient();
    const { error, count } = await supabase
        .from('customers')
        .update(patch, { count: 'exact' })
        .eq('id', customerId);

    if (error) return { ok: false, error: describeDbError(error) };
    // USING не пропустил строку: RLS не даёт ошибку, только 0 строк.
    if (count === 0) return { ok: false, error: "Customer not found, or you don't have permission." };
    return { ok: true, data: null };
}