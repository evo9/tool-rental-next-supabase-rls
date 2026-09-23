import type { Metadata } from 'next'
import { getTools } from '@/features/tools/queries'
import { ToolsTable } from '@/features/tools/components/tools-table'

export const metadata: Metadata = { title: 'Tools' }

export default async function ToolsPage() {
    const tools = await getTools()

    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-semibold">Tools</h1>
            <ToolsTable tools={tools} />
        </div>
    )
}