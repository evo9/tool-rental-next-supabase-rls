'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addUnit } from '../actions';

/** Форму показывают MANAGER и выше - это UX, INSERT решает политика "manager+ can insert tool units". */
export function AddUnitForm({ toolId }: { toolId: string }) {
    const router = useRouter();
    const [inventoryNumber, setInventoryNumber] = useState('');
    const [status, setStatus] = useState<'AVAILABLE' | 'UNAVAILABLE'>('AVAILABLE');
    const [note, setNote] = useState('');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setPending(true);
        setError(null);
        const result = await addUnit({ toolId, inventoryNumber, status, note });
        setPending(false);
        if (!result.ok) {
            setError(result.error);
            return;
        }
        setInventoryNumber('');
        setNote('');
        router.refresh();
    }

    return (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3 rounded-md border p-4">
            <div className="space-y-1">
                <Label htmlFor="inventory_number">Inventory No.</Label>
                <Input
                    id="inventory_number"
                    value={inventoryNumber}
                    onChange={(e) => setInventoryNumber(e.target.value)}
                    required
                />
            </div>
            <div className="space-y-1">
                <Label htmlFor="new_unit_status">Status</Label>
                {/* RENTED и WRITTEN_OFF в списке нет: единица создаётся свободной или недоступной. */}
                <select
                    id="new_unit_status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'AVAILABLE' | 'UNAVAILABLE')}
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                >
                    <option value="AVAILABLE">Available</option>
                    <option value="UNAVAILABLE">Unavailable</option>
                </select>
            </div>
            <div className="min-w-48 flex-1 space-y-1">
                <Label htmlFor="new_unit_note">Note</Label>
                <Input id="new_unit_note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <Button type="submit" disabled={pending}>
                {pending ? 'Adding...' : 'Add unit'}
            </Button>
            {error && <p className="w-full text-sm text-red-600">{error}</p>}
        </form>
    );
}
