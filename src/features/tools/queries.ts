import 'server-only'
import { createClient } from '@/lib/supabase/server'

export async function getTools() {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('tools')
        .select('id, name, daily_rate, deposit_value')
        .order('name')

    // Пустой результат из-за RLS ошибкой не считается - придёт просто [].
    // Сюда попадём при сетевой проблеме или отсутствии GRANT.
    if (error) throw error

    return data
}

/** Модель и все её единицы. null - модели нет, не uuid в адресе или RLS её не показал. */
export async function getToolWithUnits(id: string) {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('tools')
        .select('id, name, daily_rate, deposit_value, tool_units(id, inventory_number, status, note)')
        .eq('id', id)
        .maybeSingle()

    // 22P02: в URL не uuid. Для пользователя это та же "не найдено".
    if (error?.code === '22P02') return null
    if (error) throw error
    if (!data) return null

    return {
        ...data,
        tool_units: [...data.tool_units].sort((a, b) => a.inventory_number.localeCompare(b.inventory_number)),
    }
}

/**
 * Карточка единицы: модель, статус, вся история позиций аренды с арендой
 * и клиентом. Активная позиция - та, у которой returned_at is null (не
 * больше одной на единицу, частичный индекс rental_items_active_unit).
 */
export async function getUnitDetails(id: string) {
    const supabase = await createClient()

    const { data, error } = await supabase
        .from('tool_units')
        // Один литерал, без склейки строк: типы supabase-js выводятся из
        // литерала, при конкатенации результат стал бы неразобранным.
        .select(`
            id, inventory_number, status, note, created_at,
            tools(id, name, daily_rate, deposit_value),
            rental_items(id, returned_at, amount,
                rentals(id, issued_at, planned_return_at, status, customers(id, full_name)))
        `)
        .eq('id', id)
        .maybeSingle()

    if (error?.code === '22P02') return null
    if (error) throw error
    if (!data) return null

    const history = [...data.rental_items].sort((a, b) =>
        (b.rentals?.issued_at ?? '').localeCompare(a.rentals?.issued_at ?? ''),
    )
    const current = history.find((item) => item.returned_at === null) ?? null

    return { unit: data, history, current }
}

/** Единицы для печати наклеек: по списку id или все единицы модели. */
export async function listUnitsForLabels(opts: { ids?: string[]; toolId?: string }) {
    const supabase = await createClient()

    let query = supabase
        .from('tool_units')
        .select('id, inventory_number, tools(name)')
        .order('inventory_number')
        .limit(200)

    if (opts.ids) query = query.in('id', opts.ids)
    if (opts.toolId) query = query.eq('tool_id', opts.toolId)

    const { data, error } = await query
    if (error) throw error
    return data
}
