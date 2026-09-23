// Знак Tool Rental: гаечный ключ внутри стрелки возврата.
// Цвет берётся из currentColor, поэтому задаётся классом (text-primary)
// и сам меняется в тёмной теме. Без <mask> и id внутри SVG: знак
// рендерится дважды (сайдбар и мобильная панель), одинаковые id
// на странице конфликтовали бы.
export function LogoMark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
            <g fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M22.5 4.74A13 13 0 1 1 9.5 4.74" />
                <path d="M7.54 9.34 9.5 4.74 4.54 4.14" />
            </g>
            <path fill="currentColor" d="M23.4856 10.6358A4.4 4.4 0 1 1 21.3642 8.5144L18.4393 11.4393 20.5607 13.5607Z" />
            <path stroke="currentColor" strokeWidth={3.4} strokeLinecap="round" d="M18.3 13.7 10.5 21.5" />
        </svg>
    );
}

// Знак + название. Название - обычный текст, а не часть SVG:
// тот же шрифт, что во всём интерфейсе.
export function Logo({ className }: { className?: string }) {
    return (
        <span className={`flex items-center gap-2 ${className ?? ''}`}>
            <LogoMark className="size-7 text-primary" />
            <span className="text-base font-semibold">Tool Rental</span>
        </span>
    );
}
