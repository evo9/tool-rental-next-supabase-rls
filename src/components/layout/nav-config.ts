import { ArrowLeftRight, Drill, Settings, Users, type LucideIcon } from 'lucide-react';
import type { StaffRole } from '@/lib/roles';

export type NavItem = {
    href: string;
    label: string;
    icon: LucideIcon;
    minRole: StaffRole;
};

// Куда растёт меню на следующих этапах (пока не реализовано):
//   Dashboard      /dashboard      LayoutDashboard   OPERATOR
//   Audit log      /audit-log      ScrollText        SUPERADMIN
export const NAV_ITEMS: NavItem[] = [
    { href: '/tools', label: 'Tools', icon: Drill, minRole: 'OPERATOR' },
    { href: '/customers', label: 'Customers', icon: Users, minRole: 'OPERATOR' },
    { href: '/rentals', label: 'Rentals', icon: ArrowLeftRight, minRole: 'OPERATOR' },
    // minRole OPERATOR, не MANAGER: читать grace period может любой активный
    // сотрудник (политика "staff can read grace periods"), редактирование
    // ограничено внутри страницы - там же, где решает и сама БД.
    { href: '/settings/grace', label: 'Grace periods', icon: Settings, minRole: 'OPERATOR' },
];
