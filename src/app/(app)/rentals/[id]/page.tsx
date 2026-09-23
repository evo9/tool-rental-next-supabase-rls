import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getRentalWithDetails } from '@/features/rentals/queries';
import { RentalStatusBadge } from '@/features/rentals/components/rental-status-badge';
import { ReturnForm } from '@/features/rentals/components/return-form';
import { CategoryBadge } from '@/features/customers/components/category-badge';
import { getRentalEstimate } from '@/features/pricing/queries';
import { formatDateTime, formatMoney } from '@/lib/format';

export default async function RentalPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const [result, estimate] = await Promise.all([getRentalWithDetails(id), getRentalEstimate(id)]);
    if (!result) notFound();

    const { rental, items } = result;
    // Обычный объект, а не Map: пропс идёт в клиентский компонент ниже,
    // а Map по границе серверный/клиентский компонент не сериализуется.
    // По rental_item_id: rental_estimate у не-сотрудника вернула бы пустой
    // массив (RLS внутри функции), тогда сумма просто не показывается -
    // тот же принцип "пусто, а не ошибка", что и во всей остальной базе.
    const estimateByItem: Record<string, (typeof estimate)[number]> = Object.fromEntries(
        estimate.map((e) => [e.rental_item_id, e]),
    );
    const total = estimate.reduce((sum, e) => sum + e.amount, 0);

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
                    Issued {formatDateTime(rental.issued_at)} · Due {formatDateTime(rental.planned_return_at)} ·
                    Grace {rental.grace_hours}h
                    {rental.closed_at && <> · Closed {formatDateTime(rental.closed_at)}</>}
                </p>
                {rental.note && <p className="text-sm">{rental.note}</p>}
            </div>

            <section className="space-y-3">
                <div className="flex items-center justify-between">
                    <h2 className="font-medium">Units</h2>
                    <span className="text-sm font-medium">Total {formatMoney(total)}</span>
                </div>
                <ul className="divide-y rounded-md border">
                    {items.map((item) => {
                        const itemEstimate = estimateByItem[item.id];
                        return (
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
                                        {item.returned_at
                                            ? `Returned ${formatDateTime(item.returned_at)}`
                                            : 'Not returned'}
                                    </span>
                                </div>
                                {itemEstimate && (
                                    <p className="text-sm">
                                        {itemEstimate.is_returned ? 'Charged' : 'Accruing'}:{' '}
                                        <span className="font-medium">{formatMoney(itemEstimate.amount)}</span>
                                        <span className="text-muted-foreground">
                                            {' '}
                                            ({itemEstimate.base_days} day
                                            {itemEstimate.base_days === 1 ? '' : 's'}
                                            {itemEstimate.overdue_days > 0 &&
                                                ` + ${itemEstimate.overdue_days} overdue`}
                                            )
                                        </span>
                                    </p>
                                )}
                                <div className="grid gap-2 sm:grid-cols-2">
                                    <Photo url={item.issueUrl} label="Photo on issue" />
                                    <Photo url={item.returnUrl} label="Photo on return" />
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </section>

            <ReturnForm rentalId={rental.id} items={items} estimateByItem={estimateByItem} />
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
