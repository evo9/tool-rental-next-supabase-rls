import type { Metadata } from 'next';
import { listGracePeriods } from '@/features/pricing/queries';
import { getCurrentStaffRole } from '@/features/staff/queries';
import { hasRole } from '@/lib/roles';
import { GracePeriodsTable } from '@/features/pricing/components/grace-periods-table';

export const metadata: Metadata = { title: 'Grace periods' };

export default async function GracePeriodsPage() {
    const [periods, role] = await Promise.all([listGracePeriods(), getCurrentStaffRole()]);

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <h1 className="text-2xl font-semibold">Grace periods</h1>
                <p className="text-sm text-muted-foreground">
                    Hours after the planned return date before overdue charges start, per customer category.
                    The value is fixed on each rental at issue - changing it here only affects rentals issued
                    afterwards.
                </p>
            </div>
            <GracePeriodsTable periods={periods} canEdit={hasRole(role, 'MANAGER')} />
        </div>
    );
}
