import { Link } from 'react-router'
import { Button, Money, Pill, SectionLabel } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate, formatNumber } from '../../lib/format'
import { displayName } from '../contacts/normalise'
import { codingLine, humanise } from './logic'
import type { ContactRow, GivingRefs, RecurringAgreementRow } from './types'

export interface RecurringCardProps {
  agreement: RecurringAgreementRow
  contact: ContactRow | null
  refs?: GivingRefs | null
  readOnly?: boolean
  onPause?: (agreement: RecurringAgreementRow) => void
  onReactivate?: (agreement: RecurringAgreementRow) => void
  onCancel?: (agreement: RecurringAgreementRow) => void
  onRecordPayment?: (agreement: RecurringAgreementRow) => void
}

const STATUS_TONE: Record<string, 'accent' | 'good' | 'neutral' | 'overdue' | 'waiting'> = {
  active: 'good',
  paused: 'waiting',
  cancelled: 'neutral',
  failing: 'overdue',
}

/**
 * A standing order as a card (05 §2): amount, frequency, method, last payment.
 * The **failing** state turns the card red and repeats the one instruction that
 * matters — a missed standing order is a retention emergency, so it gets a call,
 * not an email (▸ Virtuous missed-payment-as-emergency).
 */
export function RecurringCard({
  agreement,
  contact,
  refs,
  readOnly,
  onPause,
  onReactivate,
  onCancel,
  onRecordPayment,
}: RecurringCardProps) {
  const failing = agreement.status === 'failing'
  const cancelled = agreement.status === 'cancelled'

  return (
    <article
      className={cn(
        'flex flex-col gap-[8px] rounded-card border bg-surface p-4',
        failing ? 'border-flag-overdue' : 'border-border',
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
            <span className="text-[14px] font-bold">Standing order</span>
          )}
          <Pill variant="manual" tone={STATUS_TONE[agreement.status] ?? 'neutral'}>
            {humanise(agreement.status)}
          </Pill>
        </div>
        <SectionLabel tone={failing ? 'overdue' : 'muted'}>Recurring</SectionLabel>
      </div>

      {failing ? (
        <p className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] font-semibold text-flag-overdue">
          Standing order failing — {formatNumber(agreement.missed_count ?? 0)} missed. Call, don’t email.
        </p>
      ) : null}

      <div className="text-[13px]">
        <Money amount={agreement.amount} /> {agreement.frequency} · {humanise(agreement.payment_method)}
        {agreement.fund_id ? ` · ${codingLine({ fund_id: agreement.fund_id, campaign_id: null, appeal_id: null }, refs)}` : ''}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-muted">
        <span>
          {agreement.last_payment_on
            ? `Last payment ${formatDate(agreement.last_payment_on)}`
            : 'No payment recorded yet'}
        </span>
        <span>Started {formatDate(agreement.starts_on)}</span>
        {agreement.ends_on ? <span>Ends {formatDate(agreement.ends_on)}</span> : null}
        {agreement.expected_day ? <span>Expected day {agreement.expected_day}</span> : null}
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          {!cancelled ? (
            <Button size="sm" variant="accentOutline" onClick={() => onRecordPayment?.(agreement)}>
              Record payment
            </Button>
          ) : null}
          {agreement.status === 'active' || failing ? (
            <Button size="sm" variant="outline" onClick={() => onPause?.(agreement)}>
              Pause
            </Button>
          ) : null}
          {agreement.status === 'paused' || failing || cancelled ? (
            <Button size="sm" variant="outline" onClick={() => onReactivate?.(agreement)}>
              Reactivate
            </Button>
          ) : null}
          {!cancelled ? (
            <Button size="sm" variant="ghost" onClick={() => onCancel?.(agreement)}>
              Cancel
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
