import type { Metadata } from 'next'
import Link from 'next/link'
import { getTools } from '@/features/tools/queries'
import { getCurrentStaffRole } from '@/features/staff/queries'
import { ToolsTable } from '@/features/tools/components/tools-table'
import { hasRole } from '@/lib/roles'

export const metadata: Metadata = { title: 'Tools' }

export default async function ToolsPage() {
    const [tools, role] = await Promise.all([getTools(), getCurrentStaffRole()])

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h1 className="text-2xl font-semibold">Tools</h1>
                {/* Ссылку на импорт видит MANAGER и выше - это UX: вставку решают
                    политики "tools: manager+ inserts" и "manager+ can insert tool units". */}
                {hasRole(role, 'MANAGER') && (
                    <Link href="/tools/import" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
                        Import CSV
                    </Link>
                )}
            </div>
            <ToolsTable tools={tools} />
        </div>
    )
}
