import { cn } from '../lib/cn'
import { initialsOf } from '../lib/format'

export type AvatarSize = 'sm' | 'md' | 'lg'
export type AvatarTone = 'neutral' | 'accent'

export interface AvatarProps {
  /** Full name or organisation; initials are derived from it. */
  name: string | null | undefined
  /** Override the derived initials (e.g. a team member's known monogram). */
  initials?: string
  size?: AvatarSize
  tone?: AvatarTone
  className?: string
  title?: string
}

const sizes: Record<AvatarSize, string> = {
  sm: 'w-[26px] h-[26px] text-[10.5px]',
  md: 'w-[30px] h-[30px] text-[11.5px]',
  lg: 'w-[34px] h-[34px] text-[12px]',
}

const tones: Record<AvatarTone, string> = {
  neutral: 'bg-row text-nav',
  accent: 'bg-accent-soft text-accent-dark',
}

/** Initials avatar — `RA` / `DC` circles from the wireframes. */
export function Avatar({ name, initials, size = 'md', tone = 'neutral', className, title }: AvatarProps) {
  return (
    <span
      aria-hidden="true"
      title={title ?? name ?? undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold select-none',
        sizes[size],
        tones[tone],
        className,
      )}
    >
      {initials ?? initialsOf(name)}
    </span>
  )
}
