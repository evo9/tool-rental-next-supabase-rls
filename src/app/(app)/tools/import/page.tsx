import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentStaffRole } from '@/features/staff/queries';
import { ImportForm } from '@/features/import/components/import-form';
import { hasRole } from '@/lib/roles';

export const metadata: Metadata = { title: 'Import tools' };

export default async function ImportToolsPage() {
    const role = await getCurrentStaffRole();

    // UX: оператору страница показывает пояснение вместо формы. Защита не
    // здесь: эндпоинт вернёт 403, а вставки всё равно отклонят политики в базе.
    if (!hasRole(role, 'MANAGER')) {
        return (
            <div className="space-y-2">
                <h1 className="text-2xl font-semibold">Import tools</h1>
                <p className="text-sm text-muted-foreground">Only a manager or above can import tools.</p>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="space-y-1">
                <Link href="/tools" className="text-sm text-muted-foreground hover:underline">
                    Tools
                </Link>
                <h1 className="text-2xl font-semibold">Import tools from CSV</h1>
                <p className="text-sm text-muted-foreground">
                    New models are created from the file; for an existing model only the units are added and its
                    rate and deposit are left unchanged. A row with an error does not stop the rest.
                </p>
            </div>
            <ImportForm />
        </div>
    );
}
