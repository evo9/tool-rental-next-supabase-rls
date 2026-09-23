import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { StaffRole } from '@/lib/roles';

export type { StaffRole };

export async function getCurrentStaffRole(): Promise<StaffRole | null> {
    const supabase = await createClient();
    const { data } = await supabase.rpc('current_staff_role');
    return data ?? null;
}