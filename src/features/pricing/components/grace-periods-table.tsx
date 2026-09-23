'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CATEGORY_LABELS } from '@/features/customers/constants';
import { updateGraceHours } from '../actions';
import type { GracePeriod } from '../types';

/** canEdit - UX only: политика "manager+ can update grace periods" в базе
 *  решает то же самое по роли, а count === 0 в ответе покажет ошибку
 *  и OPERATOR, если он всё же отправит форму в обход интерфейса. */
export function GracePeriodsTable({ periods, canEdit }: { periods: GracePeriod[]; canEdit: boolean }) {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Grace period, hours</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {periods.map((period) => (
                    <GracePeriodRow key={period.category} period={period} canEdit={canEdit} />
                ))}
            </TableBody>
        </Table>
    );
}

function GracePeriodRow({ period, canEdit }: { period: GracePeriod; canEdit: boolean }) {
    const router = useRouter();
    const [value, setValue] = useState(String(period.grace_hours));
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const dirty = value !== String(period.grace_hours);

    async function handleSave() {
        const graceHours = Number(value);
        // Та же граница, что и check (grace_hours between 0 and 72) в базе -
        // проверка здесь только для мгновенной подсказки, база откажет сама.
        if (!Number.isInteger(graceHours) || graceHours < 0 || graceHours > 72) {
            setError('Enter a whole number between 0 and 72.');
            return;
        }
        setPending(true);
        setError(null);
        const result = await updateGraceHours(period.category, graceHours);
        setPending(false);
        if (!result.ok) {
            setError(result.error);
            return;
        }
        router.refresh();
    }

    return (
        <TableRow>
            <TableCell>{CATEGORY_LABELS[period.category]}</TableCell>
            <TableCell className="text-right">
                {canEdit ? (
                    <div className="flex items-center justify-end gap-2">
                        <Input
                            type="number"
                            min={0}
                            max={72}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            className="w-20 text-right"
                        />
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!dirty || pending}
                            onClick={handleSave}
                        >
                            {pending ? 'Saving...' : 'Save'}
                        </Button>
                    </div>
                ) : (
                    period.grace_hours
                )}
                {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
            </TableCell>
        </TableRow>
    );
}
