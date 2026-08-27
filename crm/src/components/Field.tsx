import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn'
import { SectionLabel } from './SectionLabel'

const control =
  'w-full rounded-input border border-border bg-surface px-3 py-[9px] text-[13.5px] placeholder:text-faint focus:border-accent focus:outline-none disabled:bg-ground disabled:text-muted'

export interface FieldProps {
  label: string
  /** Marks the label; only `first_name` is ever required on a contact (I-5). */
  required?: boolean
  hint?: ReactNode
  children: ReactNode
  className?: string
}

/** Label + control + optional hint. The one form row in the app. */
export function Field({ label, required, hint, children, className }: FieldProps) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-[6px]', className)}>
      <span className="text-[12px] font-semibold text-muted">
        {label}
        {required ? <span className="text-flag-overdue"> *</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[11.5px] text-faint">{hint}</span> : null}
    </label>
  )
}

export function TextInput({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...rest} />
}

export function TextArea({ className, rows = 3, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={rows} className={cn(control, 'leading-[1.45]', className)} {...rest} />
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Rendered as the empty option; omit for a select with no blank choice. */
  placeholder?: string
  options: Array<{ value: string; label: string }>
}

export function Select({ className, placeholder, options, ...rest }: SelectProps) {
  return (
    <select className={cn(control, 'appearance-none pr-8', className)} {...rest}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

export interface FieldGroupProps {
  /** `IDENTITY` — the spec's own grouping of 02 §3.1. */
  title: string
  children: ReactNode
  className?: string
}

/** A titled band of fields, matching the spec's field groups. */
export function FieldGroup({ title, children, className }: FieldGroupProps) {
  return (
    <section className={cn('flex flex-col gap-[10px]', className)}>
      <SectionLabel>{title}</SectionLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}
