import type { Metadata } from 'next';
import { listAvailableUnits } from '@/features/rentals/queries';
import { RentalForm } from '@/features/rentals/components/rental-form';

export const metadata: Metadata = { title: 'Issue rental' };

export default async function NewRentalPage({
    searchParams,
}: {
    searchParams: Promise<{ unit?: string }>;
}) {
    const [units, { unit }] = await Promise.all([listAvailableUnits(), searchParams]);

    // ?unit=<id> приходит с карточки единицы. Предвыбирается, только если
    // единица есть среди доступных: занятая или чужая просто не выберется.
    const initialUnitIds = unit && units.some((u) => u.id === unit) ? [unit] : [];

    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold">Issue rental</h1>
            <RentalForm units={units} initialUnitIds={initialUnitIds} />
        </div>
    );
}
