import { cn } from '../../lib/cn'

export type WizardStep = 'upload' | 'mapping' | 'preview' | 'dedupe' | 'dryrun' | 'done'

export const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: 'upload', label: 'File' },
  { id: 'mapping', label: 'Columns' },
  { id: 'preview', label: 'Tidy up' },
  { id: 'dedupe', label: 'Duplicates' },
  { id: 'dryrun', label: 'Dry run' },
  { id: 'done', label: 'Done' },
]

export const stepIndex = (step: WizardStep): number => STEPS.findIndex((s) => s.id === step)

export interface StepperProps {
  active: WizardStep
  /** Steps already completed can be revisited; later ones cannot be jumped to. */
  onGoTo: (step: WizardStep) => void
}

/**
 * The wizard's spine (06 §5). Numbered rather than iconic on purpose: an
 * import is one of the few places in this app where knowing *how many steps
 * are left* is the reassurance the person needs.
 */
export function Stepper({ active, onGoTo }: StepperProps) {
  const current = stepIndex(active)

  return (
    <ol className="mb-5 flex flex-wrap items-center gap-1" aria-label="Import steps">
      {STEPS.map((step, index) => {
        const state = index === current ? 'current' : index < current ? 'done' : 'todo'
        return (
          <li key={step.id} className="flex items-center gap-1">
            <button
              type="button"
              disabled={state === 'todo'}
              aria-current={state === 'current' ? 'step' : undefined}
              onClick={() => onGoTo(step.id)}
              className={cn(
                'inline-flex items-center gap-[7px] rounded-pill px-[11px] py-[5px] text-[12.5px] transition-colors',
                state === 'current' && 'bg-accent-soft font-semibold text-accent-dark',
                state === 'done' && 'text-muted hover:text-ink',
                state === 'todo' && 'cursor-not-allowed text-faint',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-[18px] w-[18px] items-center justify-center rounded-pill text-[10.5px] font-bold',
                  state === 'current' && 'bg-accent text-surface',
                  state === 'done' && 'bg-good-bg text-good',
                  state === 'todo' && 'bg-row text-faint',
                )}
              >
                {state === 'done' ? '✓' : index + 1}
              </span>
              {step.label}
            </button>
            {index < STEPS.length - 1 ? <span aria-hidden className="text-faint">›</span> : null}
          </li>
        )
      })}
    </ol>
  )
}
