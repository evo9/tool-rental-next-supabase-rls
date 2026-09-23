import type { Metadata } from 'next';
import { getCurrentStaffRole } from '@/features/staff/queries';
import { hasRole } from '@/lib/roles';
import { CustomerForm } from '@/features/customers/components/customer-form';

export const metadata: Metadata = { title: 'New customer' };

export default async function NewCustomerPage() {
    const role = await getCurrentStaffRole();

    // Скрытие выбора категории - удобство. Запрет держит политика INSERT.
    return (
        <div className="space-y-4">
            <h1 className="text-xl font-semibold">New customer</h1>
            <CustomerForm canSetCategory={hasRole(role, 'MANAGER')} />
        </div>
    );
}