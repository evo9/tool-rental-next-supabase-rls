import { Logo } from '@/components/brand/logo';
import { NavLinks } from './nav-links';
import { UserBlock } from './user-block';
import type { StaffRole } from '@/lib/roles';

// Серверный компонент: usePathname нужен только списку ссылок (NavLinks),
// поэтому клиентским остаётся только он, не весь сайдбар.
export function Sidebar({ email, role }: { email: string; role: StaffRole | null }) {
    return (
        <div className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r bg-muted/40 md:flex">
            <div className="p-4">
                <Logo />
            </div>
            <div className="flex-1 overflow-y-auto px-3">
                <NavLinks role={role} />
            </div>
            <UserBlock email={email} role={role} />
        </div>
    );
}
