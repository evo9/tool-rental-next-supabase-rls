import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { listCustomers } from '@/features/customers/queries';
import { CategoryBadge } from '@/features/customers/components/category-badge';

export const metadata: Metadata = { title: 'Customers' };

export default async function CustomersPage({
                                                searchParams,
                                            }: {
    searchParams: Promise<{ q?: string }>;
}) {
    const { q } = await searchParams;
    const customers = await listCustomers(q);

    // GET-форма: запрос уходит в ?q=..., страница перерисовывается на сервере.
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-xl font-semibold">Customers</h1>
                <Button> {/*asChild*/}
                    <Link href="/customers/new">New customer</Link>
                </Button>
            </div>

            <form className="flex max-w-md gap-2">
                <Input name="q" defaultValue={q} placeholder="Name or phone" />
                <Button type="submit" variant="outline">Search</Button>
            </form>

            {customers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No customers found</p>
            ) : (
                <ul className="divide-y rounded-md border">
                    {customers.map((c) => (
                        <li key={c.id}>
                            <Link
                                href={`/customers/${c.id}`}
                                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted"
                            >
                                <span className="font-medium">{c.full_name}</span>
                                <span className="flex items-center gap-3 text-sm text-muted-foreground">
                  {c.phone}
                                    <CategoryBadge category={c.category} />
                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}