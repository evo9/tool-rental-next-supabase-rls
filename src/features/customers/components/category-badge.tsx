import type { CustomerCategory } from '../types';
import { CATEGORY_LABELS } from '../constants';

const STYLES: Record<CustomerCategory, string> = {
    PLATINUM: 'bg-slate-800 text-white',
    GOLD: 'bg-amber-100 text-amber-900',
    SILVER: 'bg-zinc-100 text-zinc-800',
    NON_GRATA: 'bg-red-100 text-red-800',
};

export function CategoryBadge({ category }: { category: CustomerCategory }) {
    return (
        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${STYLES[category]}`}>
      {CATEGORY_LABELS[category]}
    </span>
    );
}