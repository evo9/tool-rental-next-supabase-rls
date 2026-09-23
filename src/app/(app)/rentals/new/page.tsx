import type { Metadata } from 'next';
import { listAvailableUnits } from '@/features/rentals/queries';
import { RentalForm } from '@/features/rentals/components/rental-form';

export const metadata: Metadata = { title: 'Issue rental' };

export default async function NewRentalPage() {
    const units = await listAvailableUnits();

    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold">Issue rental</h1>
            <RentalForm units={units} />
        </div>
    );
}
