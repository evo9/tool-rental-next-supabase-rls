import { TOOL_UNIT_STATUS_LABELS } from '@/features/rentals/constants';
import type { ToolUnitStatus } from '@/features/rentals/types';

const STYLES: Record<ToolUnitStatus, string> = {
    AVAILABLE: 'bg-green-100 text-green-800',
    RENTED: 'bg-blue-100 text-blue-800',
    UNAVAILABLE: 'bg-amber-100 text-amber-800',
    WRITTEN_OFF: 'bg-zinc-100 text-zinc-600',
};

export function UnitStatusBadge({ status }: { status: ToolUnitStatus }) {
    return (
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}>
            {TOOL_UNIT_STATUS_LABELS[status]}
        </span>
    );
}
