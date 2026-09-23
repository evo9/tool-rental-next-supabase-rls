'use client';

// usePathname - хук, работает только в клиентском компоненте, поэтому
// клиентским делается только этот список ссылок, а не весь сайдбар:
// подсветка активного пункта - единственное, для чего здесь нужен браузер.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { hasRole, type StaffRole } from '@/lib/roles';
import { NAV_ITEMS } from './nav-config';

export function NavLinks({
    role,
    onNavigate,
}: {
    role: StaffRole | null;
    onNavigate?: () => void;
}) {
    const pathname = usePathname();

    // Скрытие пункта по роли - удобство интерфейса, доступ к данным
    // всё равно проверяют политики RLS, а не этот список.
    const visibleItems = NAV_ITEMS.filter((item) => hasRole(role, item.minRole));

    return (
        <nav className="flex flex-col gap-1">
            {visibleItems.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                const Icon = item.icon;

                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                            'flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors',
                            active
                                ? 'bg-primary/10 font-medium text-primary'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                    >
                        <Icon className="size-4" />
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );
}
