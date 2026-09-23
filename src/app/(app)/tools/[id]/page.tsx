import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getToolWithUnits } from '@/features/tools/queries';
import { getCurrentStaffRole } from '@/features/staff/queries';
import { AddUnitForm } from '@/features/tools/components/add-unit-form';
import { UnitsTable } from '@/features/tools/components/units-table';
import { formatMoney } from '@/lib/format';
import { hasRole } from '@/lib/roles';

export const metadata: Metadata = { title: 'Tool' };

export default async function ToolPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const [tool, role] = await Promise.all([getToolWithUnits(id), getCurrentStaffRole()]);
    if (!tool) notFound();

    // canManage - UX: кнопки и форму видит MANAGER и выше. Право менять
    // единицы решают политики tool_units в базе.
    const canManage = hasRole(role, 'MANAGER');

    return (
        <div className="space-y-6">
            <div className="space-y-1">
                <Link href="/tools" className="text-sm text-muted-foreground hover:underline">
                    Tools
                </Link>
                <h1 className="text-2xl font-semibold">{tool.name}</h1>
                <p className="text-sm text-muted-foreground">
                    {formatMoney(tool.daily_rate)} per day, deposit {formatMoney(tool.deposit_value)}
                </p>
            </div>

            {canManage && (
                <section className="space-y-2">
                    <h2 className="font-medium">Add unit</h2>
                    <AddUnitForm toolId={tool.id} />
                </section>
            )}

            <section className="space-y-2">
                <h2 className="font-medium">Units ({tool.tool_units.length})</h2>
                <UnitsTable toolId={tool.id} units={tool.tool_units} canManage={canManage} />
            </section>
        </div>
    );
}
