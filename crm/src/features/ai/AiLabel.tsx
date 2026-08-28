import { Pill } from '../../components'
import { cn } from '../../lib/cn'
import { labelText, type AiLabelState } from './core'

export interface AiLabelProps {
  state: AiLabelState
  className?: string
}

/**
 * The one label, rendered everywhere AI content appears (09 §1.4 ▸ Carbon /
 * Cloudscape).
 *
 * Two states and no third: **"Drafted with AI"** until a person accepts or
 * edits, then **"Reviewed"**. It is an outlined (computed) pill on purpose —
 * I-7 reserves filled pills for things a human sets by hand, and "who wrote
 * this" is a fact about the content, not a control.
 */
export function AiLabel({ state, className }: AiLabelProps) {
  if (state === 'discarded') return null
  const reviewed = state === 'reviewed'
  return (
    <Pill
      variant="computed"
      tone={reviewed ? 'good' : 'accent'}
      className={cn('gap-[5px]', className)}
      title={
        reviewed
          ? 'A person has read this and kept it.'
          : 'Written by AI from this record only. Nothing has been sent or saved for the donor to see.'
      }
    >
      <span aria-hidden="true">{reviewed ? '✓' : '✦'}</span>
      {labelText(state)}
    </Pill>
  )
}

export interface WhyProps {
  children: React.ReactNode
  className?: string
}

/**
 * "Why am I seeing this" (09 §1.8) — the rule or evidence behind the surface.
 * Unexplained AI is the documented adoption killer, so every card carries one.
 */
export function WhyLine({ children, className }: WhyProps) {
  return <p className={cn('text-[11.5px] leading-[1.45] text-faint', className)}>{children}</p>
}
