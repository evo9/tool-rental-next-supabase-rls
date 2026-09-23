import { ArrowLeftRight, Drill, LayoutDashboard, ScrollText, Settings, Users, type LucideIcon } from 'lucide-react';
import type { StaffRole } from '@/lib/roles';

export type NavItem = {
    href: string;
    label: string;
    icon: LucideIcon;
    minRole: StaffRole;
};

export const NAV_ITEMS: NavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, minRole: 'OPERATOR' },
    { href: '/tools', label: 'Tools', icon: Drill, minRole: 'OPERATOR' },
    { href: '/customers', label: 'Customers', icon: Users, minRole: 'OPERATOR' },
    { href: '/rentals', label: 'Rentals', icon: ArrowLeftRight, minRole: 'OPERATOR' },
    // minRole OPERATOR, не MANAGER: читать grace period может любой активный
    // сотрудник (политика "staff can read grace periods"), редактирование
    // ограничено внутри страницы - там же, где решает и сама БД.
    { href: '/settings/grace', label: 'Grace periods', icon: Settings, minRole: 'OPERATOR' },
    // Скрыт для OPERATOR/MANAGER - это UX, защита - политика
    // "superadmin reads audit log". Прямой переход на /audit им покажет
    // пустой список, а не 403 - тот же принцип, что и во всей базе.
    { href: '/audit', label: 'Audit log', icon: ScrollText, minRole: 'SUPERADMIN' },
];
