'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ToolUnitStatus } from '@/features/rentals/types';
import { setUnitStatus } from '../actions';
import { UnitStatusBadge } from './unit-status-badge';

type Unit = { id: string; inventory_number: string; status: ToolUnitStatus; note: string | null };

/**
 * canManage - UX only: кнопки смены статуса видит MANAGER и выше. Право
 * решает политика "manager+ can update tool units", допустимость перехода -
 * триггер tool_units_guard_status; OPERATOR, отправивший запрос в обход
 * интерфейса, получит "0 строк".
 */
export function UnitsTable({
    toolId,
    units,
    canManage,
}: {
    toolId: string;
    units: Unit[];
    canManage: boolean;
}) {
    const router = useRouter();
    const [selected, setSelected] = useState<string[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    function toggle(id: string) {
        setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
    }

    async function changeStatus(unit: Unit, status: 'AVAILABLE' | 'UNAVAILABLE' | 'WRITTEN_OFF') {
        // Списание необратимо (WRITTEN_OFF - конечный статус), поэтому с подтверждением.
        if (
            status === 'WRITTEN_OFF' &&
            !window.confirm(`Write off ${unit.inventory_number}? This cannot be undone.`)
        ) {
            return;
        }
        setBusyId(unit.id);
        setError(null);
        const result = await setUnitStatus(unit.id, status);
        setBusyId(null);
        if (!result.ok) {
            setError(`${unit.inventory_number}: ${result.error}`);
            return;
        }
        router.refresh();
    }

    if (units.length === 0) {
        return <p className="text-sm text-muted-foreground">This model has no units yet.</p>;
    }

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
                {selected.length > 0 ? (
                    <Link
                        href={`/tools/print-labels?ids=${selected.join(',')}`}
                        className="rounded-md border px-3 py-1.5 hover:bg-muted"
                    >
                        Print {selected.length} selected label(s)
                    </Link>
                ) : (
                    <span className="text-muted-foreground">Select units to print labels</span>
                )}
                <Link href={`/tools/print-labels?tool=${toolId}`} className="rounded-md border px-3 py-1.5 hover:bg-muted">
                    Print all labels
                </Link>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-8" />
                        <TableHead>Inventory No.</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Note</TableHead>
                        {canManage && <TableHead className="text-right">Actions</TableHead>}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {units.map((unit) => {
                        // RENTED меняется только возвратом, WRITTEN_OFF - конечный статус.
                        const editable = canManage && (unit.status === 'AVAILABLE' || unit.status === 'UNAVAILABLE');
                        return (
                            <TableRow key={unit.id}>
                                <TableCell>
                                    <input
                                        type="checkbox"
                                        aria-label={`Select ${unit.inventory_number}`}
                                        checked={selected.includes(unit.id)}
                                        onChange={() => toggle(unit.id)}
                                    />
                                </TableCell>
                                <TableCell>
                                    <Link href={`/units/${unit.id}`} className="font-medium hover:underline">
                                        {unit.inventory_number}
                                    </Link>
                                </TableCell>
                                <TableCell>
                                    <UnitStatusBadge status={unit.status} />
                                </TableCell>
                                <TableCell className="text-muted-foreground">{unit.note}</TableCell>
                                {canManage && (
                                    <TableCell className="text-right">
                                        {editable && (
                                            <div className="flex justify-end gap-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={busyId === unit.id}
                                                    onClick={() =>
                                                        changeStatus(
                                                            unit,
                                                            unit.status === 'AVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE',
                                                        )
                                                    }
                                                >
                                                    {unit.status === 'AVAILABLE' ? 'Make unavailable' : 'Make available'}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={busyId === unit.id}
                                                    onClick={() => changeStatus(unit, 'WRITTEN_OFF')}
                                                >
                                                    Write off
                                                </Button>
                                            </div>
                                        )}
                                    </TableCell>
                                )}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
        </div>
    );
}
