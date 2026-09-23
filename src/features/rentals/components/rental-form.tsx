'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { issueRental, attachIssuePhoto } from '../actions';
import { uploadRentalPhoto } from '../upload';
import { CustomerPicker, type CustomerResult } from './customer-picker';
import { UnitPicker } from './unit-picker';
import type { listAvailableUnits } from '../queries';

type Unit = Awaited<ReturnType<typeof listAvailableUnits>>[number];

function defaultPlannedReturn(): string {
    // "Завтра, в это же время" - удобная точка старта, не единственный
    // вариант: оператор меняет значение сам.
    const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
    d.setSeconds(0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RentalForm({ units, initialUnitIds = [] }: { units: Unit[]; initialUnitIds?: string[] }) {
    const router = useRouter();
    const [customer, setCustomer] = useState<CustomerResult | null>(null);
    const [unitIds, setUnitIds] = useState<string[]>(initialUnitIds);
    const [photos, setPhotos] = useState<Record<string, File | null>>({});
    const [plannedReturnAt, setPlannedReturnAt] = useState(defaultPlannedReturn);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [createdId, setCreatedId] = useState<string | null>(null);

    const unitsById = new Map(units.map((u) => [u.id, u]));

    async function handleSubmit() {
        if (!customer) {
            setError('Select a customer.');
            return;
        }
        if (unitIds.length === 0) {
            setError('Select at least one unit.');
            return;
        }
        setPending(true);
        setError(null);

        // Шаг 1: аренда и все её позиции одной транзакцией (RPC issue_rental,
        // глава 04) - RLS и гранты вызывающего работают внутри как обычно.
        const issued = await issueRental({
            customerId: customer.id,
            plannedReturnAt: new Date(plannedReturnAt).toISOString(),
            unitIds,
        });

        if (!issued.ok) {
            setError(issued.error);
            setPending(false);
            return;
        }

        // Шаги 2-3: фото каждой единицы в Storage из браузера, затем путь -
        // в rental_items.issue_photo_path. Фото до этого момента держались
        // только в памяти браузера (File в состоянии компонента).
        const failures: string[] = [];
        for (const item of issued.data.items) {
            const file = photos[item.toolUnitId];
            if (!file) continue;
            try {
                const path = await uploadRentalPhoto(issued.data.rentalId, item.rentalItemId, 'issue', file);
                const attached = await attachIssuePhoto(item.rentalItemId, path);
                if (!attached.ok) failures.push(attached.error);
            } catch (err) {
                failures.push((err as Error).message);
            }
        }

        if (failures.length > 0) {
            setCreatedId(issued.data.rentalId);
            setError(`Rental created, but some photos weren't saved: ${failures.join('; ')}.`);
            setPending(false);
            return;
        }

        router.push(`/rentals/${issued.data.rentalId}`);
    }

    return (
        <div className="max-w-xl space-y-6">
            <div className="space-y-2">
                <Label>Customer</Label>
                {customer ? (
                    <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                        <span>
                            {customer.full_name} <span className="text-muted-foreground">{customer.phone}</span>
                        </span>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setCustomer(null)}>
                            Change
                        </Button>
                    </div>
                ) : (
                    <CustomerPicker onSelect={setCustomer} />
                )}
            </div>

            <div className="space-y-1">
                <Label htmlFor="planned_return_at">Due date</Label>
                <Input
                    id="planned_return_at"
                    type="datetime-local"
                    value={plannedReturnAt}
                    onChange={(e) => setPlannedReturnAt(e.target.value)}
                    required
                />
            </div>

            <div className="space-y-2">
                <Label>Units</Label>
                <UnitPicker units={units} selectedIds={unitIds} onChange={setUnitIds} />
            </div>

            {unitIds.length > 0 && (
                <div className="space-y-3">
                    <Label>Photo on issue</Label>
                    {unitIds.map((id) => {
                        const unit = unitsById.get(id);
                        if (!unit) return null;
                        return (
                            <div key={id} className="space-y-1">
                                <p className="text-sm">
                                    {unit.inventory_number}
                                    {unit.tools && <span className="text-muted-foreground"> - {unit.tools.name}</span>}
                                </p>
                                <Input
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp"
                                    capture="environment"
                                    onChange={(e) => setPhotos((p) => ({ ...p, [id]: e.target.files?.[0] ?? null }))}
                                />
                            </div>
                        );
                    })}
                </div>
            )}

            {error && (
                <p className="text-sm text-red-600">
                    {error}{' '}
                    {createdId && (
                        <Link href={`/rentals/${createdId}`} className="underline">
                            Open rental
                        </Link>
                    )}
                </p>
            )}

            <Button
                type="button"
                size="lg"
                className="w-full"
                disabled={pending || createdId !== null}
                onClick={handleSubmit}
            >
                {pending ? 'Issuing...' : 'Issue rental'}
            </Button>
        </div>
    );
}
