'use client';

import { useState, useTransition } from 'react';
import { Input } from '@/components/ui/input';
import { CategoryBadge } from '@/features/customers/components/category-badge';
import { searchCustomers } from '../actions';

export type CustomerResult = Awaited<ReturnType<typeof searchCustomers>>[number];

/** Поиск клиента по имени или телефону - тот же server action, что и
 *  список клиентов, только вызывается интерактивно с клиента. */
export function CustomerPicker({ onSelect }: { onSelect: (customer: CustomerResult) => void }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<CustomerResult[]>([]);
    const [pending, startTransition] = useTransition();

    function handleChange(value: string) {
        setQuery(value);
        if (value.trim().length < 2) {
            setResults([]);
            return;
        }
        startTransition(async () => {
            setResults(await searchCustomers(value));
        });
    }

    return (
        <div className="space-y-2">
            <Input
                value={query}
                onChange={(e) => handleChange(e.target.value)}
                placeholder="Search customer by name or phone"
            />
            {pending && <p className="text-sm text-muted-foreground">Searching...</p>}
            {results.length > 0 && (
                <ul className="divide-y rounded-md border">
                    {results.map((c) => (
                        <li key={c.id}>
                            <button
                                type="button"
                                onClick={() => onSelect(c)}
                                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                            >
                                <span>{c.full_name}</span>
                                <span className="flex items-center gap-2 text-muted-foreground">
                                    {c.phone}
                                    <CategoryBadge category={c.category} />
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
