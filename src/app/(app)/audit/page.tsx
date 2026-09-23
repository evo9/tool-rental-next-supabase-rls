import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listAuditLog, listStaffForFilter, AUDIT_PAGE_SIZE } from '@/features/audit/queries';
import { AUDITED_TABLES, isAuditedTable } from '@/features/audit/types';
import { AuditRow } from '@/features/audit/components/audit-row';

export const metadata: Metadata = { title: 'Audit log' };

type SearchParams = { table?: string; actor?: string; from?: string; to?: string; before?: string };

function buildHref(current: SearchParams, overrides: Partial<SearchParams>) {
    const merged = { ...current, ...overrides };
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) {
        if (value) qs.set(key, value);
    }
    const s = qs.toString();
    return s ? `/audit?${s}` : '/audit';
}

// Защита - политика "superadmin reads audit log" в базе, не эта страница:
// у OPERATOR/MANAGER запрос просто вернёт пустой список (RLS), не ошибку.
// Скрытие пункта меню - nav-config.ts, тоже только для удобства.
export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
    const params = await searchParams;
    const tableName = isAuditedTable(params.table) ? params.table : undefined;
    // Смена любого фильтра, кроме "показать ещё", сбрасывает курсор
    // страницы - иначе новая выборка со старым курсором могла бы начаться
    // не с самого начала.
    const filterParams: SearchParams = { table: params.table, actor: params.actor, from: params.from, to: params.to };

    const [rows, staff] = await Promise.all([
        listAuditLog({
            tableName,
            actorId: params.actor || undefined,
            dateFrom: params.from || undefined,
            dateTo: params.to || undefined,
            before: params.before ? Number(params.before) : undefined,
        }),
        listStaffForFilter(),
    ]);

    const hasMore = rows.length === AUDIT_PAGE_SIZE;
    const lastId = rows.at(-1)?.id;
    const hasActiveFilters = Boolean(params.actor || params.from || params.to);

    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold">Audit log</h1>

            <div className="flex flex-wrap gap-2 text-sm">
                <Link
                    href={buildHref(filterParams, { table: undefined, before: undefined })}
                    className={`rounded-md px-3 py-1.5 ${
                        !tableName ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'
                    }`}
                >
                    All tables
                </Link>
                {AUDITED_TABLES.map((t) => (
                    <Link
                        key={t}
                        href={buildHref(filterParams, { table: t, before: undefined })}
                        className={`rounded-md px-3 py-1.5 ${
                            tableName === t
                                ? 'bg-primary/10 font-medium text-primary'
                                : 'text-muted-foreground hover:bg-muted'
                        }`}
                    >
                        {t}
                    </Link>
                ))}
            </div>

            <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
                {tableName && <input type="hidden" name="table" value={tableName} />}
                <label className="flex flex-col gap-1">
                    Staff
                    <select
                        name="actor"
                        defaultValue={params.actor ?? ''}
                        className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                        <option value="">All</option>
                        {staff.map((s) => (
                            <option key={s.user_id} value={s.user_id}>
                                {s.full_name}
                            </option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1">
                    From
                    <Input type="date" name="from" defaultValue={params.from} className="w-36" />
                </label>
                <label className="flex flex-col gap-1">
                    To
                    <Input type="date" name="to" defaultValue={params.to} className="w-36" />
                </label>
                <Button type="submit" variant="outline" size="sm">
                    Apply
                </Button>
                {hasActiveFilters && (
                    <Link
                        href={buildHref(filterParams, { actor: undefined, from: undefined, to: undefined, before: undefined })}
                        className="text-muted-foreground hover:underline"
                    >
                        Clear
                    </Link>
                )}
            </form>

            {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No audit records found.</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {rows.map((row) => (
                        <AuditRow key={row.id} row={row} />
                    ))}
                </ul>
            )}

            {hasMore && lastId && (
                <Link
                    href={buildHref(filterParams, { before: String(lastId) })}
                    className="text-sm text-primary hover:underline"
                >
                    Older records
                </Link>
            )}
        </div>
    );
}
