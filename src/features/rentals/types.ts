import type { Database } from '@/types/database';

export type Rental = Database['public']['Tables']['rentals']['Row'];
export type RentalItem = Database['public']['Tables']['rental_items']['Row'];
export type RentalStatus = Database['public']['Enums']['rental_status'];
export type ToolUnitStatus = Database['public']['Enums']['tool_unit_status'];

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** UX только: подсветка просрочки. Само правило - в главе 04 книги. */
export function isOverdue(rental: Pick<Rental, 'status' | 'planned_return_at'>): boolean {
    return rental.status === 'ACTIVE' && new Date(rental.planned_return_at) < new Date();
}
