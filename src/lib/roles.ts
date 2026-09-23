import type { Database } from '@/types/database';

export type StaffRole = Database['public']['Enums']['staff_role'];

// Порядок = иерархия ролей в БД (public.staff_role), см. миграцию этапа 2.
const RANK: Record<StaffRole, number> = { OPERATOR: 1, MANAGER: 2, SUPERADMIN: 3 };

/** Только для интерфейса (показать/скрыть, подсветить пункт меню). Защита - политики в БД. */
export function hasRole(role: StaffRole | null, min: StaffRole): boolean {
    return role !== null && RANK[role] >= RANK[min];
}
