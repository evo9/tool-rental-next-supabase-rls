import 'server-only';
import { createClient } from '@/lib/supabase/server';

export const AUDIT_PAGE_SIZE = 50;

export type AuditLogFilters = {
    tableName?: string;
    actorId?: string;
    dateFrom?: string;
    dateTo?: string;
    /** id последней строки предыдущей страницы - пагинация по id, не по offset. */
    before?: number;
};

/** Только SUPERADMIN получит строки (политика "superadmin reads audit
 *  log") - у остальных ролей грант select есть, но пусто, тот же принцип,
 *  что и во всей остальной базе. Имя сотрудника - отдельным запросом:
 *  actor_id намеренно без внешнего ключа на staff (лог переживает
 *  удаление строки сотрудника), поэтому PostgREST не умеет embedding. */
export async function listAuditLog(filters: AuditLogFilters) {
    const supabase = await createClient();

    let query = supabase
        .from('audit_log')
        .select('*')
        .order('id', { ascending: false })
        .limit(AUDIT_PAGE_SIZE);

    if (filters.tableName) query = query.eq('table_name', filters.tableName);
    if (filters.actorId) query = query.eq('actor_id', filters.actorId);
    if (filters.dateFrom) query = query.gte('at', filters.dateFrom);
    if (filters.dateTo) query = query.lte('at', filters.dateTo);
    if (filters.before) query = query.lt('id', filters.before);

    const { data: rows, error } = await query;
    if (error) throw error;

    const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => id !== null))];
    const nameByActor = new Map<string, string>();
    if (actorIds.length > 0) {
        const { data: staffRows } = await supabase.from('staff').select('user_id, full_name').in('user_id', actorIds);
        for (const s of staffRows ?? []) nameByActor.set(s.user_id, s.full_name);
    }

    return rows.map((row) => ({
        ...row,
        // Деактивированный или удалённый сотрудник - "Unknown", не пустая
        // строка: отличает "был сотрудник, но не нашли" от "не было автора".
        actorName: row.actor_id ? (nameByActor.get(row.actor_id) ?? 'Unknown') : 'System',
    }));
}

/** Для фильтра "сотрудник" - все, включая деактивированных: лог мог
 *  записать их действия ещё до деактивации. */
export async function listStaffForFilter() {
    const supabase = await createClient();
    const { data, error } = await supabase.from('staff').select('user_id, full_name').order('full_name');
    if (error) throw error;
    return data;
}
