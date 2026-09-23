import type { Metadata } from 'next'
import { Logo } from '@/components/brand/logo'
import { LoginForm } from './login-form'

export const metadata: Metadata = { title: 'Sign in' }

// Серверный компонент: страница входа - без сайдбара, только лого и форма.
// Форма клиентская (useActionState), лого и сама страница остаются на сервере.
export default function LoginPage() {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
            <Logo />
            <LoginForm />
        </div>
    )
}
