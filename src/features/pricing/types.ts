import type { Database } from '@/types/database';

export type GracePeriod = Database['public']['Tables']['category_grace_periods']['Row'];
export type RentalEstimateRow = Database['public']['Functions']['rental_estimate']['Returns'][number];

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };
