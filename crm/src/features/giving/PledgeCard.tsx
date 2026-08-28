import { Link } from 'react-router'
import { Button, Money, Pill, ProgressBar, SectionLabel } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate, formatMoney } from '../../lib/format'
import { displayName } from '../contacts/normalise'
import { codingLine, humanise, pledgeProgress } from './logic'
import type {
  ContactRow,
  DonationRow,
  GivingRefs,
  PledgeInstallmentRow,
  PledgeRow,
} from './types'

export interface PledgeCardProps {
  pledge: PledgeRow
  contact: ContactRow | null
  donations: DonationRow[]
  installments: PledgeInstallmentRow[]
  refs?: GivingRefs | null
  /** Write-off is admin-only (11 §1). */
  canWriteOff?: boolean
  readOnly?: boolean
  /** Gifts read through the redacted view carry no paid figure (11 §2). */
  amountsHidden?: boolean
  onRecordPayment?: (pledge: PledgeRow, installment: PledgeInstallmentRow | null) => void
  onWriteOff?: (pledge: PledgeRow) => void
  onCancel?: (pledge: PledgeRow) => void
}

const STATUS_TONE: Record<string, 'accent' | 'good' | 'neutral' | 'overdue'> = {
  open: 'accent',
  fulfilled: 'good',
  written_off: 'neutral',
  cancelled: 'neutral',
}

/**
 * The pledge card (05 §2): progress against the total, balance due, the next
 * installment and any overdue ones — overdue is computed, never stored
 * (02 §3.5). Payments are recorded as ordinary gifts through the applies-to
 * preset, so the ledger has one shape only.
 */
export function PledgeCard({
  pledge,
  contact,
  donations,
  installments,
  refs,
  canWriteOff,
  readOnly,
  amountsHidden,
  onRecordPayment,
  onWriteOff,
  onCancel,
}: PledgeCardProps) {
  const progress = pledgeProgress(pledge, { donations, installments })
  // Sorted here rather than trusting the fetch order — the schedule reads as a
  // schedule only in date order.
  const mine = installments
    .filter((row) => row.pledge_id === pledge.id)
    .sort((a, b) => a.due_on.localeCompare(b.due_on))
  const closed = pledge.status !== 'open'

  return (
    <article
      className={cn(
        'flex flex-col gap-[10px] rounded-card border bg-surface p-4',
        progress.overdue.length > 0 && !closed ? 'border-flag-overdue' : 'border-border',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          {contact ? (
            <Link
              to={`/contacts/${contact.id}`}
              className="text-[14px] font-bold text-accent-dark hover:underline"
            >
              {displayName(contact)}
            </Link>
          ) : (
            <span className="text-[14px] font-bold">Pledge</span>
          )}
          <Pill variant="manual" tone={STATUS_TONE[pledge.status] ?? 'neutral'}>
            {humanise(pledge.status)}
          </Pill>
        </div>
        <span className="text-[12.5px] text-muted">
          Pledged {formatDate(pledge.pledged_on)} · {codingLine(pledge, refs)}
        </span>
      </div>

      {/* Without the payments the bar would read a misleading 0% — show the
          schedule without the arithmetic instead (11 §2). */}
      {amountsHidden ? null : (
        <div className="flex items-center gap-3">
          <ProgressBar
            value={progress.fraction}
            label={`${formatMoney(progress.paid)} of ${formatMoney(progress.total)} paid`}
            className="grow"
          />
          <span className="tabular shrink-0 text-[12px] text-muted">
            {formatMoney(progress.paid)} / {formatMoney(progress.total)}
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px] text-muted">
        {amountsHidden ? null : (
          <span>
            Balance <Money amount={progress.balance} />
          </span>
        )}
        {progress.writtenOff > 0 ? <span>Written off {formatMoney(progress.writtenOff)}</span> : null}
        {progress.next ? (
          <span>
            Next {formatMoney(progress.next.amount)} · {formatDate(progress.next.due_on)}
          </span>
        ) : null}
        {progress.overdue.length > 0 ? (
          <span className="font-semibold text-flag-overdue">
            {progress.overdue.length} overdue installment{progress.overdue.length === 1 ? '' : 's'} —{' '}
            {formatMoney(progress.overdue.reduce((sum, row) => sum + row.amount, 0))}
          </span>
        ) : null}
      </div>

      {mine.length > 0 ? (
        <div className="flex flex-col gap-1">
          <SectionLabel>Schedule</SectionLabel>
          <ul className="flex flex-col gap-[3px] text-[12.5px]">
            {mine.map((row) => {
              const overdue = progress.overdue.some((o) => o.id === row.id)
              return (
                <li
                  key={row.id}
                  className={cn(
                    'flex items-baseline gap-2',
                    overdue ? 'font-semibold text-flag-overdue' : 'text-nav',
                  )}
                >
                  <span className="tabular w-[92px] shrink-0">{formatDate(row.due_on)}</span>
                  <span className="tabular w-[80px] shrink-0">{formatMoney(row.amount)}</span>
                  <span className="text-muted">
                    {overdue ? 'overdue' : humanise(row.status).toLowerCase()}
                  </span>
                  {!readOnly && row.status === 'expected' && !closed ? (
                    <button
                      type="button"
                      onClick={() => onRecordPayment?.(pledge, row)}
                      className="ml-auto text-[12px] font-semibold text-accent hover:text-accent-dark"
                    >
                      Record payment
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      {!readOnly && !closed ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="accentOutline" onClick={() => onRecordPayment?.(pledge, progress.next)}>
            Record payment
          </Button>
          {canWriteOff ? (
            <Button size="sm" variant="outline" onClick={() => onWriteOff?.(pledge)}>
              Write off
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onCancel?.(pledge)}>
            Cancel pledge
          </Button>
        </div>
      ) : null}

      {pledge.notes ? <p className="text-[12px] whitespace-pre-line text-faint">{pledge.notes}</p> : null}
    </article>
  )
}
