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