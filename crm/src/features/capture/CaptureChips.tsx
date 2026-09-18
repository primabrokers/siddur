import { useId, useState, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { formatResolvedDate } from '../../lib/jewish-dates'
import type { NextActionDraft } from './captureState'

/**
 * The chip vocabulary of the confirm sheet (04 §4 pane 2, and the exact values
 * in `wireframes/QuickCapture.dc.html`).
 *
 * A chip is glanceable first and editable second: it reads as a plain pill
 * until it is tapped, then it opens the smallest control that can correct it.
 * That is the whole interaction model of the pane — "glance at the chips, tap
 * any to correct".
 */

/* --------------------------------------------------------------- chip shell */

export interface ChipProps {
  children: ReactNode
  onClick?: () => void
  /** Dashed + teal: an AI-resolved value that is explicitly refusable. */
  resolved?: boolean
  /** Bolder text for the leading chip in a row (kind, action type). */
  strong?: boolean
  /** Money renders in gold with tabular numerals. */
  money?: boolean
  active?: boolean
  className?: string
  'aria-label'?: string
}

export function Chip({
  children,
  onClick,
  resolved = false,
  strong = false,
  money = false,
  active = false,
  className,
  ...rest
}: ChipProps) {
  const base = cn(
    'inline-flex items-center gap-[5px] rounded-pill px-[12px] py-[5px] text-[12.5px] leading-[1.35] whitespace-nowrap transition-colors',
    resolved
      ? 'border-[1.5px] border-dashed border-accent bg-accent-soft font-semibold text-accent-dark'
      : 'border border-chip-border text-ink',
    active && !resolved && 'bg-accent-soft border-accent text-accent-dark font-semibold',
    strong && 'font-semibold',
    money && 'tabular font-bold text-gold',
    className,
  )
  if (!onClick) return <span className={base}>{children}</span>
  return (
    <button type="button" onClick={onClick} className={cn(base, 'hover:border-faint')} {...rest}>
      {children}
      <span aria-hidden="true" className="text-[10px] opacity-70">
        ▾
      </span>
    </button>
  )
}

/* ------------------------------------------------------------- chip + field */

const control =
  'w-full rounded-input border border-border bg-surface px-3 py-[7px] text-[13px] placeholder:text-faint focus:border-accent focus:outline-none'

export interface ChipFieldProps {
  /** What the collapsed pill says. */
  label: ReactNode
  /** The field's name, for the expanded label. */
  name: string
  strong?: boolean
  money?: boolean
  /** Rendered when open; receives the input class so every control matches. */
  children: (inputClassName: string) => ReactNode
  /** Start open — used when a value is missing and must be supplied. */
  defaultOpen?: boolean
}

/**
 * A chip that becomes a labelled field in place. Nothing is hidden behind a
 * second sheet: a correction is one tap and one keystroke away.
 */
export function ChipField({ label, name, strong, money, children, defaultOpen = false }: ChipFieldProps) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  if (!open) {
    return (
      <Chip onClick={() => setOpen(true)} strong={strong} money={money} aria-label={`Edit ${name}`}>
        {label}
      </Chip>
    )
  }

  return (
    <span className="flex min-w-[150px] grow basis-[150px] flex-col gap-[3px]">
      <label htmlFor={id} className="text-[11px] font-semibold text-muted">
        {name}
      </label>
      <span className="flex items-center gap-1">
        {children(control)}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={`Done editing ${name}`}
          className="shrink-0 rounded-input px-2 py-[7px] text-[12px] text-muted hover:text-ink"
        >
          ✓
        </button>
      </span>
    </span>
  )
}

/* ---------------------------------------------------------------- date chip */

export interface DateChipProps {
  nextAction: NextActionDraft
  onDateChange: (value: string) => void
}

/**
 * The signature chip: "after sukkos → **Tue 6 Oct**", dashed teal because the
 * resolution is the resolver's proposal and the human may refuse it (09 §2 /
 * ▸ Todoist–Fantastical live parse).
 *
 * Three states:
 *   - resolved & confident → the arrow chip, tap to open a date input
 *   - resolved but fuzzy ("around chanukah") → same chip, flagged "≈"
 *   - unresolved → an empty date input with the phrase as helper text; the
 *     resolver never guesses, so the human fills it in.
 */
export function DateChip({ nextAction, onDateChange }: DateChipProps) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const { dateExpression, resolution, dueOn } = nextAction

  const unresolved = !resolution && dueOn === ''
  const showInput = open || unresolved

  if (showInput) {
    return (
      <span className="flex min-w-[170px] grow basis-[170px] flex-col gap-[3px]">
        <label htmlFor={id} className="text-[11px] font-semibold text-muted">
          Due
        </label>
        <input
          id={id}
          type="date"
          value={dueOn}
          onChange={(event) => onDateChange(event.target.value)}
          className={control}
        />
        {dateExpression ? (
          <span className="text-[11px] text-faint">
            {unresolved ? `Heard “${dateExpression}” — no date to work out from that.` : `From “${dateExpression}”`}
          </span>
        ) : null}
      </span>
    )
  }

  const shown = resolution?.date ?? dueOn
  return (
    <Chip resolved onClick={() => setOpen(true)} aria-label="Change the due date">
      {dateExpression ? <span className="font-normal">{dateExpression} → </span> : null}
      <span>{formatResolvedDate(shown)}</span>
      {resolution && !resolution.confident ? (
        <span title="Approximate — worth a glance" aria-label="approximate">
          ≈
        </span>
      ) : null}
    </Chip>
  )
}

/* --------------------------------------------------------------- provenance */

/**
 * "Parsed from your note · AI · original kept" (04 §4) — and the original,
 * one tap away. Provenance is a hard requirement, not a nicety (09 §1.3):
 * every AI-touched record can be traced back to what was actually said.
 */
export function ProvenanceLine({ rawText }: { rawText: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col gap-[6px]">
      <p className="text-center text-[11.5px] text-faint">
        Parsed from your note{' '}
        <span className="rounded-[4px] border border-[#C9BC96] px-[5px] text-[10px] font-bold text-[#6B5A26]">AI</span> ·
        original kept ·{' '}
        <button type="button" onClick={() => setOpen((v) => !v)} className="text-accent underline-offset-2 hover:underline">
          {open ? 'hide it' : 'see it'}
        </button>
      </p>
      {open ? (
        <p className="rounded-card border border-border bg-ground px-3 py-2 text-[12px] leading-[1.5] text-muted">
          {rawText}
        </p>
      ) : null}
    </div>
  )
}
