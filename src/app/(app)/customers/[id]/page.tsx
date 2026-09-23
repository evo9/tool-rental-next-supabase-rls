import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getCustomerWithPhotos } from '@/features/customers/queries';
import { CategoryBadge } from '@/features/customers/components/category-badge';
import { AttachPhotosForm } from '@/features/customers/components/attach-photos-form';
import { listCustomerRentals } from '@/features/rentals/queries';
import { RentalStatusBadge } from '@/features/rentals/components/rental-status-badge';
import { formatDateTime } from '@/lib/format';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await getCustomerWithPhotos(id);
    if (!result) notFound();

    const { customer, photoUrl, documentUrl } = result;
    const rentals = await listCustomerRentals(customer.id);

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <h1 className="flex items-center gap-3 text-xl font-semibold">
                    {customer.full_name}
                    <CategoryBadge category={customer.category} />
                </h1>
                <p className="text-sm text-muted-foreground">{customer.phone}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <Photo url={photoUrl} label="Customer photo" />
                <Photo url={documentUrl} label="Document" />
            </div>

            <section className="space-y-2">
                <h2 className="font-medium">Add or replace photos</h2>
                <AttachPhotosForm customerId={customer.id} />
            </section>

            <section className="space-y-2">
                <h2 className="font-medium">Rentals</h2>
                {rentals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No rentals yet</p>
                ) : (
                    <ul className="divide-y rounded-md border">
                        {rentals.map((r) => (
                            <li key={r.id}>
                                <Link
                                    href={`/rentals/${r.id}`}
                                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted"
                                >
                                    <span className="text-sm">Due {formatDateTime(r.planned_return_at)}</span>
                                    <RentalStatusBadge rental={r} />
                                </Link>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function Photo({ url, label }: { url: string | null; label: string }) {
    return (
        <figure className="space-y-1">
            <figcaption className="text-sm text-muted-foreground">{label}</figcaption>
            {url ? (
                // Обычный img: next/image закешировал бы файл на сервере дольше срока подписи.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={url} alt={label} className="max-h-80 w-full rounded-md border object-contain" />
            ) : (
                <div className="flex h-40 items-center justify-center rounded-md border text-sm text-muted-foreground">
                    No photo
                </div>
            )}
        </figure>
    );
}