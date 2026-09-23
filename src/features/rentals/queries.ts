import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { RENTAL_PHOTOS_BUCKET, PHOTO_URL_TTL } from './constants';
import type { RentalStatus } from './types';

export async function listRentals(status?: RentalStatus) {
    const supabase = await createClient();

    let query = supabase
        .from('rentals')
        .select('id, planned_return_at, issued_at, status, closed_at, customers(id, full_name, phone)')
        // 'ACTIVE' < 'CLOSED' по алфавиту - активные аренды оказываются
        // сверху без отдельного выражения для сортировки по статусу.
        .order('status', { ascending: true })
        .order('planned_return_at', { ascending: true })
        .limit(100);

    if (status) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) throw error;
    return data;
}

export async function listCustomerRentals(customerId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase
        .from('rentals')
        .select('id, planned_return_at, issued_at, status, closed_at')
        .eq('customer_id', customerId)
        .order('issued_at', { ascending: false });

    if (error) throw error;
    return data;
}

export async function getRentalWithDetails(id: string) {
    const supabase = await createClient();

    const { data: rental, error } = await supabase
        .from('rentals')
        .select(
            '*, customers(id, full_name, phone, category), rental_items(*, tool_units(id, inventory_number, tools(name)))',
        )
        .eq('id', id)
        .maybeSingle();

    // 22P02: в URL не uuid. Для пользователя это та же "не найдено".
    if (error?.code === '22P02') return null;
    if (error) throw error;
    if (!rental) return null;

    // Подпись создаётся сессионным клиентом: Storage проверит SELECT-политику
    // на storage.objects для этого пользователя (тот же приём, что у фото
    // клиентов на этапе 3).
    const paths = rental.rental_items
        .flatMap((item) => [item.issue_photo_path, item.return_photo_path])
        .filter((p): p is string => p !== null);

    const urls = new Map<string, string>();
    if (paths.length > 0) {
        const { data } = await supabase.storage
            .from(RENTAL_PHOTOS_BUCKET)
            .createSignedUrls(paths, PHOTO_URL_TTL);
        for (const item of data ?? []) {
            if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
        }
    }

    return {
        rental,
        items: rental.rental_items.map((item) => ({
            ...item,
            issueUrl: item.issue_photo_path ? urls.get(item.issue_photo_path) ?? null : null,
            returnUrl: item.return_photo_path ? urls.get(item.return_photo_path) ?? null : null,
        })),
    };
}

/**
 * Единицы, доступные для выдачи, с названием модели. Список умеренный
 * (одна точка проката), поэтому поиск по инвентарному номеру и модели -
 * на клиенте, по уже загруженному списку, а не отдельным запросом на
 * каждое нажатие клавиши.
 */
export async function listAvailableUnits() {
    const supabase = await createClient();

    const { data, error } = await supabase
        .from('tool_units')
        .select('id, inventory_number, tools(name)')
        .eq('status', 'AVAILABLE')
        .order('inventory_number')
        .limit(500);

    if (error) throw error;
    return data;
}
