import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Счётчики дашборда из view dashboard_counts. Сессионный клиент: view
 * создан с security_invoker, поэтому RLS базовых таблиц работает от имени
 * пользователя (глава 07). Не-сотрудник получит одну строку из нулей, anon -
 * 42501; подменять эти значения в коде не нужно, защита в базе.
 */
export async function getDashboardCounts() {
    const supabase = await createClient();

    const { data, error } = await supabase.from('dashboard_counts').select('*').single();
    if (error) throw error;

    // Типы view в database.ts все nullable (Postgres не выводит not null
    // для агрегатов), фактически count(*) никогда не null.
    return {
        available: data.available ?? 0,
        rented: data.rented ?? 0,
        unavailable: data.unavailable ?? 0,
        writtenOff: data.written_off ?? 0,
        activeRentals: data.active_rentals ?? 0,
        overdueRentals: data.overdue_rentals ?? 0,
    };
}

/**
 * Просроченные аренды: то же правило, что в overdue_rentals (ACTIVE и
 * planned_return_at в прошлом), поэтому длина списка совпадает со счётчиком,
 * пока их не обрезает limit. Время сравнивается по часам сервера приложения,
 * счётчик - по now() базы: расхождение в секунды на списке не заметно.
 */
export async function listOverdueRentals() {
    const supabase = await createClient();

    const { data, error } = await supabase
        .from('rentals')
        .select('id, planned_return_at, customers(id, full_name)')
        .eq('status', 'ACTIVE')
        .lt('planned_return_at', new Date().toISOString())
        .order('planned_return_at', { ascending: true })
        .limit(50);

    if (error) throw error;
    return data;
}
