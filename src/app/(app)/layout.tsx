import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentStaffRole } from '@/features/staff/queries';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileNav } from '@/components/layout/mobile-nav';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Прокси уже редиректит, но layout проверяет ещё раз:
    // на него полагается весь код внутри, и user здесь точно есть.
    if (!user) redirect('/login');

    // Нет активной строки в staff - null, тот же случай, что и сейчас:
    // страницы всё равно отдадут пустые данные через RLS, а не ошибку.
    const role = await getCurrentStaffRole();

    return (
        <div className="flex min-h-screen">
            <Sidebar email={user.email ?? ''} role={role} />
            <div className="flex min-w-0 flex-1 flex-col">
                <MobileNav email={user.email ?? ''} role={role} />
                <main className="min-w-0 max-w-6xl p-6 md:p-8">{children}</main>
            </div>
        </div>
    );
}
