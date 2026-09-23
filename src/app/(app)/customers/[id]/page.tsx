import { notFound } from 'next/navigation';
import { getCustomerWithPhotos } from '@/features/customers/queries';
import { CategoryBadge } from '@/features/customers/components/category-badge';
import { AttachPhotosForm } from '@/features/customers/components/attach-photos-form';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const result = await getCustomerWithPhotos(id);
    if (!result) notFound();

    const { customer, photoUrl, documentUrl } = result;

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