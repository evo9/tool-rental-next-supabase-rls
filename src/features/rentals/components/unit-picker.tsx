'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import type { listAvailableUnits } from '../queries';

// import type - стирается при сборке, серверный код listAvailableUnits
// (server-only) в клиентский бандл не попадает, нужен только тип строки.
type Unit = Awaited<ReturnType<typeof listAvailableUnits>>[number];

/** Список единиц уже загружен целиком (страница /rentals/new, только
 *  AVAILABLE) - поиск и множественный выбор идут по нему на клиенте,
 *  без отдельного запроса на каждое нажатие клавиши. */
export function UnitPicker({
    units,
    selectedIds,
    onChange,
}: {
    units: Unit[];
    selectedIds: string[];
    onChange: (ids: string[]) => void;
}) {
    const [query, setQuery] = useState('');

    const filtered = useMemo(() => {
        const term = query.trim().toLowerCase();
        if (!term) return units;
        return units.filter(
            (u) =>
                u.inventory_number.toLowerCase().includes(term) ||
                (u.tools?.name.toLowerCase().includes(term) ?? false),
        );
    }, [units, query]);

    function toggle(id: string) {
        onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
    }

    return (
        <div className="space-y-2">
            <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by inventory No. or model"
            />
            <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
                {filtered.length === 0 && (
                    <li className="px-3 py-2 text-sm text-muted-foreground">No available units found</li>
                )}
                {filtered.map((u) => {
                    const checked = selectedIds.includes(u.id);
                    return (
                        <li key={u.id}>
                            <button
                                type="button"
                                onClick={() => toggle(u.id)}
                                className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm ${
                                    checked ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
                                }`}
                            >
                                <span>
                                    <span className="font-medium">{u.inventory_number}</span>
                                    {u.tools && <span className="text-muted-foreground"> - {u.tools.name}</span>}
                                </span>
                                {checked && <span>Selected</span>}
                            </button>
                        </li>
                    );
                })}
            </ul>
            <p className="text-sm text-muted-foreground">{selectedIds.length} unit(s) selected</p>
        </div>
    );
}
