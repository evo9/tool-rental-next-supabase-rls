import { ArrowLeftRight, Drill, Users, type LucideIcon } from 'lucide-react';
import type { StaffRole } from '@/lib/roles';

export type NavItem = {
    href: string;
    label: string;
    icon: LucideIcon;
    minRole: StaffRole;
};

// Куда растёт меню на следующих этапах (пока не реализовано):
//   Dashboard      /dashboard      LayoutDashboard   OPERATOR
//   Grace periods  /grace-periods  Settings          MANAGER
//   Audit log      /audit-log      ScrollText        SUPERADMIN
export const NAV_ITEMS: NavItem[] = [
    { href: '/tools', label: 'Tools', icon: Drill, minRole: 'OPERATOR' },
    { href: '/customers', label: 'Customers', icon: Users, minRole: 'OPERATOR' },
    { href: '/rentals', label: 'Rentals', icon: ArrowLeftRight, minRole: 'OPERATOR' },
];
