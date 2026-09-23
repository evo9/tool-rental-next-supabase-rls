'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Logo } from '@/components/brand/logo';
import { NavLinks } from './nav-links';
import { UserBlock } from './user-block';
import type { StaffRole } from '@/lib/roles';

export function MobileNav({ email, role }: { email: string; role: StaffRole | null }) {
    const [open, setOpen] = useState(false);
    const pathname = usePathname();

    // Переход мог произойти не по пункту меню (кнопка "назад" браузера,
    // ссылка внутри страницы) - закрываем меню при любой смене маршрута.
    // Сброс состояния прямо во время рендера (React docs, "Adjusting state
    // when a prop changes"), а не в useEffect: без лишнего цикла рендера
    // после коммита и без предупреждения react-hooks/set-state-in-effect.
    const [prevPathname, setPrevPathname] = useState(pathname);
    if (pathname !== prevPathname) {
        setPrevPathname(pathname);
        setOpen(false);
    }

    return (
        <div className="sticky top-0 z-40 flex items-center gap-3 border-b bg-background px-4 py-3 md:hidden print:hidden">
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
                    <Menu className="size-5" />
                </SheetTrigger>
                <SheetContent
                    side="left"
                    className="p-0"
                    // Sheet по умолчанию - 75% ширины экрана с потолком sm:max-w-sm
                    // (24rem); здесь фиксированная ширина по заданию, не зависящая
                    // от точки breakpoint.
                    style={{ width: '18rem', maxWidth: '18rem' }}
                >
                    <SheetTitle className="sr-only">Menu</SheetTitle>
                    <div className="flex h-full flex-col">
                        <div className="p-4">
                            <Logo />
                        </div>
                        <div className="flex-1 overflow-y-auto px-3">
                            <NavLinks role={role} onNavigate={() => setOpen(false)} />
                        </div>
                        <UserBlock email={email} role={role} />
                    </div>
                </SheetContent>
            </Sheet>
            <Logo />
        </div>
    );
}
