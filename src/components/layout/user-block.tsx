import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { logout } from '@/app/(app)/actions';
import { ROLE_LABELS } from '@/features/staff/constants';
import type { StaffRole } from '@/lib/roles';

// Нет активной строки в staff (role === null) - Sign out остаётся доступным,
// но роль показать нечего: доступ к данным и так закрыт RLS.
export function UserBlock({ email, role }: { email: string; role: StaffRole | null }) {
    return (
        <div className="flex items-center gap-2 border-t p-3">
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{email}</p>
                <p className="truncate text-xs text-muted-foreground">
                    {role ? ROLE_LABELS[role] : 'No access'}
                </p>
            </div>
            <form action={logout}>
                <Button variant="ghost" size="icon-sm" type="submit" aria-label="Sign out">
                    <LogOut className="size-4" />
                </Button>
            </form>
        </div>
    );
}
