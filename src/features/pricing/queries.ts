import 'server-only';
import { createClient } from '@/lib/supabase/server';

export async function listGracePeriods() {
    const supabase = await createClient();

    const { data, error } = await supabase
        .from('category_grace_periods')
        .select('*')
        .order('category');

    if (error) throw error;
    return data;
}

/** Сумма по каждой позиции аренды на текущий момент - для открытых
 *  считает на лету, для закрытых отдаёт сохранённый amount (этап 5,
 *  public.rental_estimate). RLS внутри функции: у не-сотрудника вернёт
 *  пустой массив, не ошибку. */
export async function getRentalEstimate(rentalId: string) {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('rental_estimate', { p_rental_id: rentalId });

    if (error) throw error;
    return data;
}
