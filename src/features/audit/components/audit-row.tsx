'use client';

import { useState } from 'react';
import { formatDateTime } from '@/lib/format';
import type { AuditLogRow } from '../types';

type Row = AuditLogRow & { actorName: string };

const OP_LABELS: Record<string, string> = { INSERT: 'Created', UPDATE: 'Updated', DELETE: 'Deleted' };

function field(data: unknown, key: string): unknown {
    return data && typeof data === 'object' ? (data as Record<string, unknown>)[key] : undefined;
}

/** Раскрытие по клику - diff по changed_fields для UPDATE, весь снимок
 *  для INSERT/DELETE (у них нет "было и стало", только одно состояние). */
export function AuditRow({ row }: { row: Row }) {
    const [open, setOpen] = useState(false);

    return (
        <li className="px-4 py-3">
            <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                onClick={() => setOpen((o) => !o)}
            >
                <span className="flex items-center gap-2">
                    <span className="font-medium">{OP_LABELS[row.op] ?? row.op}</span>
                    <span className="text-muted-foreground">{row.table_name}</span>
                    <span className="text-xs text-muted-foreground">#{row.row_pk.slice(0, 8)}</span>
                </span>
                <span className="flex items-center gap-3 text-sm text-muted-foreground">
                    {row.actorName}
                    <span>{formatDateTime(row.at)}</span>
                </span>
            </button>

            {open && (
                <div className="mt-2 space-y-1.5 rounded-md bg-muted/50 p-3 text-xs">
                    {row.op === 'UPDATE' && row.changed_fields && row.changed_fields.length > 0 ? (
                        row.changed_fields.map((key) => (
                            <div key={key} className="grid grid-cols-[minmax(0,120px)_1fr_1fr] gap-2">
                                <span className="font-medium">{key}</span>
                                <span className="truncate text-red-700 line-through">
                                    {JSON.stringify(field(row.old_data, key))}
                                </span>
                                <span className="truncate text-green-700">
                                    {JSON.stringify(field(row.new_data, key))}
                                </span>
                            </div>
                        ))
                    ) : (
                        <pre className="overflow-x-auto whitespace-pre-wrap">
                            {JSON.stringify(row.op === 'DELETE' ? row.old_data : row.new_data, null, 2)}
                        </pre>
                    )}
                </div>
            )}
        </li>
    );
}
