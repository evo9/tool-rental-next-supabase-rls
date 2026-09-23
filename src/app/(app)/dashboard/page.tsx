import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getDashboardCounts, listOverdueRentals } from '@/features/dashboard/queries';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
    const [counts, overdue] = await Promise.all([getDashboardCounts(), listOverdueRentals()]);

    // Ссылка есть только там, где есть куда идти: список аренд фильтруется
    // по статусу, единицы по статусу пока не фильтруются.
    const cards: { label: string; value: number; href?: string; alert?: boolean }[] = [
        { label: 'Available units', value: counts.available },
        { label: 'Rented units', value: counts.rented },
        { label: 'Unavailable units', value: counts.unavailable },
        { label: 'Written off units', value: counts.writtenOff },
        { label: 'Active rentals', value: counts.activeRentals, href: '/rentals?status=ACTIVE' },
        { label: 'Overdue rentals', value: counts.overdueRentals, href: '/rentals?status=ACTIVE', alert: true },
    ];

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold">Dashboard</h1>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {cards.map((c) => {
                    const highlight = c.alert && c.value > 0;
                    const card = (
                        <Card>
                            <CardHeader>
                                <CardDescription>{c.label}</CardDescription>
                                <CardTitle className={`text-3xl ${highlight ? 'text-red-700' : ''}`}>
                                    {c.value}
                                </CardTitle>
                            </CardHeader>
                        </Card>
                    );
                    return c.href ? (
                        <Link key={c.label} href={c.href} className="rounded-xl hover:ring-2 hover:ring-primary/30">
                            {card}
                        </Link>
                    ) : (
                        <div key={c.label}>{card}</div>
                    );
                })}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Overdue rentals</CardTitle>
                    <CardDescription>Active rentals past their planned return date, oldest first.</CardDescription>
                </CardHeader>
                <CardContent>
                    {overdue.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No overdue rentals</p>
                    ) : (
                        <ul className="divide-y rounded-md border">
                            {overdue.map((r) => (
                                <li key={r.id}>
                                    <Link
                                        href={`/rentals/${r.id}`}
                                        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-muted"
                                    >
                                        <span className="font-medium">{r.customers?.full_name}</span>
                                        <span className="text-sm text-red-700">
                                            Due {formatDateTime(r.planned_return_at)}
                                        </span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
