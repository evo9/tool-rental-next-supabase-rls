import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logout } from './actions';
import { Button } from '@/components/ui/button';

export default async function AppLayout({children}: { children: React.ReactNode }) {
    const supabase = await createClient();
    const {data: {user}} = await supabase.auth.getUser();

    // Прокси уже редиректит, но layout проверяет ещё раз:
    // на него полагается весь код внутри, и user здесь точно есть.
    if (!user) redirect('/login');

    return (
        <div className="min-h-screen">
            <header className="flex items-center justify-between border-b px-6 py-3">
                <nav className="flex gap-4 text-sm">
                    <a href="/tools">Инструмент</a>
                </nav>
                <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{user.email}</span>
                    <form action={logout}>
                        <Button variant="ghost" size="sm" type="submit">Выйти</Button>
                    </form>
                </div>
            </header>
            <main className="p-6">{children}</main>
        </div>
    );
}