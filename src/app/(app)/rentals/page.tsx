import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { listRentals } from '@/features/rentals/queries';
import { RentalStatusBadge } from '@/features/rentals/components/rental-status-badge';
import type { RentalStatus } from '@/features/rentals/types';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Rentals' };

const FILTERS: { label: string; value: RentalStatus | undefined }[] = [
    { label: 'All', value: undefined },
    { label: 'Active', value: 'ACTIVE' },
    { label: 'Closed', value: 'CLOSED' },
];

export default async function RentalsPage({
    searchParams,
}: {
    searchParams: Promise<{ status?: string }>;
}) {
    const { status } = await searchParams;
    const rentalStatus = status === 'ACTIVE' || status === 'CLOSED' ? status : undefined;
    const rentals = await listRentals(rentalStatus);

    // Активные аренды приходят раньше закрытых - см. сортировку
    // в listRentals, здесь только переключатель фильтра.
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-semibold">Rentals</h1>
                <Button>
                    <Link href="/rentals/new">Issue rental</Link>
                </Button>
            </div>

            <div className="flex gap-2 text-sm">
                {FILTERS.map((f) => (
                    <Link
                        key={f.label}
                        href={f.value ? `/rentals?status=${f.value}` : '/rentals'}
                        className={`rounded-md px-3 py-1.5 ${
                            rentalStatus === f.value
                                ? 'bg-primary/10 font-medium text-primary'
                                : 'text-muted-foreground hover:bg-muted'
                        }`}
                    >
                        {f.label}
                    </Link>
                ))}
            </div>

            {rentals.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rentals found</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {rentals.map((r) => (
                        <li key={r.id}>
                            <Link
                                href={`/rentals/${r.id}`}
                                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted"
                            >
                                <span className="font-medium">{r.customers?.full_name}</span>
                                <span className="flex items-center gap-3 text-sm text-muted-foreground">
                                    Due {formatDateTime(r.planned_return_at)}
                                    <RentalStatusBadge rental={r} />
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
