import { RENTAL_STATUS_LABELS } from '../constants';
import { isOverdue, type Rental } from '../types';

export function RentalStatusBadge({ rental }: { rental: Pick<Rental, 'status' | 'planned_return_at'> }) {
    if (isOverdue(rental)) {
        return (
            <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                Overdue
            </span>
        );
    }

    const style =
        rental.status === 'ACTIVE'
            ? 'bg-blue-100 text-blue-800'
            : 'bg-zinc-100 text-zinc-800';

    return (
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${style}`}>
            {RENTAL_STATUS_LABELS[rental.status]}
        </span>
    );
}
