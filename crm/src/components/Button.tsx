import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../lib/cn'

export type ButtonVariant = 'primary' | 'outline' | 'accentOutline' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-surface font-semibold hover:bg-accent-dark',
  outline: 'border border-border bg-surface text-nav font-semibold hover:border-faint',
  accentOutline: 'border border-accent bg-surface text-accent font-semibold hover:bg-accent-soft',
  ghost: 'text-muted hover:text-ink',
  danger: 'bg-flag-overdue text-surface font-semibold hover:opacity-90',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'rounded-[7px] px-3 py-[5px] text-[12px]',
  md: 'rounded-input px-[14px] py-2 text-[13px]',
  lg: 'rounded-card-lg px-4 py-[14px] text-[15px] font-bold',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-[6px] leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  )
}
