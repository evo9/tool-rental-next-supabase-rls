import type { Database } from '@/types/database';

export type AuditLogRow = Database['public']['Tables']['audit_log']['Row'];

/** Те же семь таблиц, что в триггерах миграции этапа 6. */
export const AUDITED_TABLES = [
    'staff',
    'tools',
    'tool_units',
    'customers',
    'rentals',
    'rental_items',
    'category_grace_periods',
] as const;

export type AuditedTable = (typeof AUDITED_TABLES)[number];

export function isAuditedTable(value: string | undefined): value is AuditedTable {
    return AUDITED_TABLES.includes(value as AuditedTable);
}
