import { Pill } from '../../components'
import { cn } from '../../lib/cn'
import { summarySentence } from './plan'
import type { DryRunSummary } from './types'

export interface DryRunStepProps {
  summary: DryRunSummary
  filename: string
  /** Unknown fund names the user has ticked to create. */
  createFunds: string[]
  onToggleFund: (name: string) => void
  /** True when gift columns were mapped but no fund column was. */
  giftsWithoutFund: boolean
}

/**
 * Step 5 — the dry run (06 §5).
 *
 * The last screen before anything is written, and the only one that states the
 * whole outcome in one sentence: *"142 contacts, 3 held for review, 890
 * gifts"*. Everything else on the page explains that sentence.
 *
 * Unknown fund names are the one thing that still needs a decision here:
 * gifts cannot be filed without a fund, so each unrecognised name is offered
 * for creation, and any left unticked take their gifts out of the run — said
 * plainly rather than discovered afterwards.
 */
export function DryRunStep({
  summary,
  filename,
  createFunds,
  onToggleFund,
  giftsWithoutFund,
}: DryRunStepProps) {
  const tiles: Array<{ label: string; value: number; tone: 'plain' | 'good' | 'warn' | 'bad' }> = [
    { label: 'New contacts', value: summary.contacts, tone: 'good' },
    { label: 'Existing filled in', value: summary.merged, tone: 'plain' },
    { label: 'Held for review', value: summary.held, tone: summary.held > 0 ? 'warn' : 'plain' },
    { label: 'Skipped', value: summary.skipped, tone: 'plain' },
    { label: 'Gifts', value: summary.gifts, tone: 'plain' },
    { label: 'Unusable rows', value: summary.blocked, tone: summary.blocked > 0 ? 'bad' : 'plain' },
  ]

  const orphanGifts = summary.giftsWithoutFund

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border bg-surface p-4" data-testid="dryrun-summary">
        <p className="text-[11.5px] font-semibold tracking-[.04em] text-muted uppercase">
          {filename} — nothing written yet
        </p>
        <p className="mt-1 text-[19px] leading-[1.3] font-bold" data-testid="dryrun-sentence">
          {summarySentence(summary)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className={cn(
              'rounded-card border bg-surface px-3 py-3',
              tile.tone === 'good' && tile.value > 0 ? 'border-good' : 'border-border',
              tile.tone === 'warn' && tile.value > 0 ? 'border-flag-today' : '',
              tile.tone === 'bad' && tile.value > 0 ? 'border-flag-overdue' : '',
            )}
          >
            <p className="text-[20px] leading-none font-bold tabular-nums">{tile.value.toLocaleString('en-GB')}</p>
            <p className="mt-1 text-[11.5px] text-muted">{tile.label}</p>
          </div>
        ))}
      </div>

      {giftsWithoutFund ? (
        <p className="rounded-input bg-[#FCF0E3] px-3 py-2 text-[12.5px] text-flag-today-ink">
          The sheet has gifts but no fund column. Gifts have to be filed under a fund, so none will be
          imported — go back and map one.
        </p>
      ) : orphanGifts > 0 ? (
        <p className="rounded-input bg-[#FCF0E3] px-3 py-2 text-[12.5px] text-flag-today-ink">
          {orphanGifts} {orphanGifts === 1 ? 'gift has' : 'gifts have'} no fund to be filed under and will
          not be imported. Tick its fund below to bring {orphanGifts === 1 ? 'it' : 'them'} in.
        </p>
      ) : null}

      {summary.unknownFunds.length > 0 ? (
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-[13.5px] font-semibold">Funds this sheet mentions that we do not have</p>
          <p className="mt-1 text-[12.5px] text-muted">
            Tick the ones to create. Gifts whose fund is left unticked are not imported.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {summary.unknownFunds.map((name) => {
              const checked = createFunds.includes(name)
              return (
                <li key={name}>
                  <label className="flex items-center gap-2 text-[13px]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleFund(name)}
                      className="h-[15px] w-[15px] accent-[#0E6E6B]"
                    />
                    <span className="font-semibold">{name}</span>
                    {checked ? (
                      <Pill variant="computed" tone="good">
                        will be created
                      </Pill>
                    ) : (
                      <Pill variant="computed" tone="today">
                        gifts skipped
                      </Pill>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {summary.held > 0 ? (
        <p className="rounded-input bg-[#FCF0E3] px-3 py-2 text-[12.5px] text-flag-today-ink">
          {summary.held} {summary.held === 1 ? 'row is' : 'rows are'} held for review and will not be
          written. They stay in this file — go back a step to decide, or re-import them later.
        </p>
      ) : null}
    </div>
  )
}
