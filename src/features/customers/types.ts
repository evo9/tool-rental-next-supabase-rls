import type { Database } from '@/types/database';

export type Customer = Database['public']['Tables']['customers']['Row'];
export type CustomerCategory = Database['public']['Enums']['customer_category'];

export const CUSTOMER_CATEGORIES: CustomerCategory[] = ['PLATINUM', 'GOLD', 'SILVER', 'NON_GRATA'];

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };