import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getRentalWithDetails } from '@/features/rentals/queries';
import { RentalStatusBadge } from '@/features/rentals/components/rental-status-badge';
import { ReturnForm } from '@/features/rentals/components/return-form';
import { CategoryBadge } from '@/features/customers/components/category-badge';
import { formatDateTime } from '@/lib/format';

export default async function RentalPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await getRentalWithDetails(id);
    if (!result) notFound();

    const { rental, items } = result;

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <h1 className="flex items-center gap-3 text-xl font-semibold">
                    <Link href={`/customers/${rental.customers?.id}`} className="hover:underline">
                        {rental.customers?.full_name}
                    </Link>
                    {rental.customers && <CategoryBadge category={rental.customers.category} />}
                    <RentalStatusBadge rental={rental} />
                </h1>
                <p className="text-sm text-muted-foreground">
                    Issued {formatDateTime(rental.issued_at)} · Due {formatDateTime(rental.planned_return_at)}
                    {rental.closed_at && <> · Closed {formatDateTime(rental.closed_at)}</>}
                </p>
                {rental.note && <p className="text-sm">{rental.note}</p>}
            </div>

            <section className="space-y-3">
                <h2 className="font-medium">Units</h2>
                <ul className="divide-y rounded-md border">
                    {items.map((item) => (
                        <li key={item.id} className="space-y-2 px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-medium">
                                    {item.tool_units?.inventory_number}
                                    {item.tool_units?.tools && (
                                        <span className="font-normal text-muted-foreground">
                                            {' '}
                                            - {item.tool_units.tools.name}
                                        </span>
                                    )}
                                </span>
                                <span className="text-sm text-muted-foreground">
                                    {item.returned_at ? `Returned ${formatDateTime(item.returned_at)}` : 'Not returned'}
                                </span>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                <Photo url={item.issueUrl} label="Photo on issue" />
                                <Photo url={item.returnUrl} label="Photo on return" />
                            </div>
                        </li>
                    ))}
                </ul>
            </section>

            <ReturnForm rentalId={rental.id} items={items} />
        </div>
    );
}

function Photo({ url, label }: { url: string | null; label: string }) {
    return (
        <figure className="space-y-1">
            <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
            {url ? (
                // Обычный img: next/image закешировал бы файл на сервере дольше срока подписи.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={label} className="max-h-48 w-full rounded-md border object-contain" />
            ) : (
                <div className="flex h-24 items-center justify-center rounded-md border text-xs text-muted-foreground">
                    No photo
                </div>
            )}
        </figure>
    );
}
