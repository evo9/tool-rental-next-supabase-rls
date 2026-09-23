import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { getUnitDetails } from '@/features/tools/queries';
import { unitQrSvg } from '@/features/tools/qr';
import { UnitStatusBadge } from '@/features/tools/components/unit-status-badge';
import { RentalStatusBadge } from '@/features/rentals/components/rental-status-badge';
import { formatDateTime, formatMoney } from '@/lib/format';

export const metadata: Metadata = { title: 'Unit' };

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const details = await getUnitDetails(id);
    if (!details) notFound();

    const { unit, history, current } = details;
    const qr = await unitQrSvg(unit.id);

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                {unit.tools && (
                    <Link href={`/tools/${unit.tools.id}`} className="text-sm text-muted-foreground hover:underline">
                        {unit.tools.name}
                    </Link>
                )}
                <h1 className="flex items-center gap-3 text-2xl font-semibold">
                    {unit.inventory_number}
                    <UnitStatusBadge status={unit.status} />
                </h1>
                {unit.note && <p className="text-sm text-muted-foreground">{unit.note}</p>}
                {unit.tools && (
                    <p className="text-sm text-muted-foreground">
                        {formatMoney(unit.tools.daily_rate)} per day, deposit {formatMoney(unit.tools.deposit_value)}
                    </p>
                )}
            </div>

            {/* Кнопки ведут в существующие потоки этапа 4. Доступность решает
                статус единицы, а не роль: выдавать и принимать может любой сотрудник. */}
            <div className="flex flex-wrap gap-2">
                {unit.status === 'AVAILABLE' && (
                    <Button>
                        <Link href={`/rentals/new?unit=${unit.id}`}>Issue</Link>
                    </Button>
                )}
                {unit.status === 'RENTED' && current?.rentals && (
                    <Button>
                        <Link href={`/rentals/${current.rentals.id}`}>Accept return</Link>
                    </Button>
                )}
                <Button variant="outline">
                    <Link href={`/tools/print-labels?ids=${unit.id}`}>Print label</Link>
                </Button>
            </div>

            <div className="flex flex-wrap items-start gap-8">
                <section className="space-y-2">
                    <h2 className="font-medium">QR code</h2>
                    <div
                        className="h-40 w-40 rounded-md border bg-white p-2 [&>svg]:h-full [&>svg]:w-full"
                        // Разметку целиком строит библиотека qrcode из адреса и uuid, см. qr.ts.
                        dangerouslySetInnerHTML={{ __html: qr }}
                    />
                </section>

                <section className="min-w-64 flex-1 space-y-2">
                    <h2 className="font-medium">Current rental</h2>
                    {current?.rentals ? (
                        <Link
                            href={`/rentals/${current.rentals.id}`}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-3 hover:bg-muted"
                        >
                            <span className="font-medium">{current.rentals.customers?.full_name}</span>
                            <span className="flex items-center gap-3 text-sm text-muted-foreground">
                                Due {formatDateTime(current.rentals.planned_return_at)}
                                <RentalStatusBadge rental={current.rentals} />
                            </span>
                        </Link>
                    ) : (
                        <p className="text-sm text-muted-foreground">Not rented out</p>
                    )}
                </section>
            </div>

            <section className="space-y-2">
                <h2 className="font-medium">Rental history</h2>
                {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">This unit has never been rented</p>
                ) : (
                    <ul className="divide-y rounded-md border">
                        {history.map((item) =>
                            item.rentals ? (
                                <li key={item.id}>
                                    <Link
                                        href={`/rentals/${item.rentals.id}`}
                                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted"
                                    >
                                        <span>
                                            <span className="font-medium">{item.rentals.customers?.full_name}</span>
                                            <span className="text-sm text-muted-foreground">
                                                {' '}
                                                - issued {formatDateTime(item.rentals.issued_at)}
                                            </span>
                                        </span>
                                        <span className="text-sm text-muted-foreground">
                                            {item.returned_at
                                                ? `returned ${formatDateTime(item.returned_at)}, ${formatMoney(item.amount ?? 0)}`
                                                : 'not returned'}
                                        </span>
                                    </Link>
                                </li>
                            ) : null,
                        )}
                    </ul>
                )}
            </section>
        </div>
    );
}
