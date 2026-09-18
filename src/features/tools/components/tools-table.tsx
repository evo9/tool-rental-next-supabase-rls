import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

type Tool = {
    id: string
    name: string
    daily_rate: number
    deposit_value: number
}

export function ToolsTable({ tools }: { tools: Tool[] }) {
    if (tools.length === 0) {
        return <p className="text-muted-foreground">Инструмент не найден.</p>
    }

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead className="text-right">Тариф за сутки</TableHead>
                    <TableHead className="text-right">Залог</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {tools.map((tool) => (
                    <TableRow key={tool.id}>
                        <TableCell>{tool.name}</TableCell>
                        <TableCell className="text-right">{tool.daily_rate}</TableCell>
                        <TableCell className="text-right">{tool.deposit_value}</TableCell>
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    )
}