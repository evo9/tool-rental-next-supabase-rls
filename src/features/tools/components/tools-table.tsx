import Link from 'next/link'
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { formatMoney } from '@/lib/format'

type Tool = {
    id: string
    name: string
    daily_rate: number
    deposit_value: number
}

export function ToolsTable({ tools }: { tools: Tool[] }) {
    if (tools.length === 0) {
        return <p className="text-muted-foreground">No tools found.</p>
    }

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="text-right">Daily rate</TableHead>
                    <TableHead className="text-right">Deposit</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {tools.map((tool) => (
                    <TableRow key={tool.id}>
                        <TableCell>
                            <Link href={`/tools/${tool.id}`} className="font-medium hover:underline">
                                {tool.name}
                            </Link>
                        </TableCell>
                        <TableCell className="text-right">{formatMoney(tool.daily_rate)}</TableCell>
                        <TableCell className="text-right">{formatMoney(tool.deposit_value)}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
}