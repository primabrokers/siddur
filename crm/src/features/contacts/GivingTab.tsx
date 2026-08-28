import { useState } from 'react'
import { Button, EmptyState, Menu, Money, Pill, ProgressBar, SectionLabel } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate, formatMoney, formatNumber } from '../../lib/format'
import { isPastDay } from '../../lib/dates'
import { GiftSheet } from '../giving/GiftSheet'
import { PledgeSheet } from '../giving/PledgeSheet'
import { RecurringSheet } from '../giving/RecurringSheet'
import type { ContactGiving, ContactStats, GivingRefs, PledgeInstallmentRow, PledgeRow } from './types'

const STATUS_TONE: Record<string, string> = {
  sent: 'text-good',
  done: 'text-good',
  claimed: 'text-good',
  eligible: 'text-accent-dark',
  queued: 'text-flag-today-ink',
  task_open: 'text-flag-today-ink',
  pending_declaration: 'text-flag-today-ink',
  not_sent: 'text-muted',
  not_done: 'text-muted',
  not_required: 'text-faint',
  ineligible: 'text-faint',
}

const humanise = (value: string | null | undefined): string =>
  (value ?? '—').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

function paidOf(pledge: PledgeRow, giving: ContactGiving): number {
  return giving.donations
    .filter((d) => d.pledge_id === pledge.id && d.status === 'received')
    .reduce((total, d) => total + (d.amount_gbp ?? d.amount ?? 0), 0)
}

function nextInstallment(
  pledge: PledgeRow,
  installments: PledgeInstallmentRow[],
): PledgeInstallmentRow | null {
  const open = installments
    .filter((i) => i.pledge_id === pledge.id && i.status === 'expected')
    .sort((a, b) => a.due_on.localeCompare(b.due_on))
  return open[0] ?? null
}

export interface PledgeCardProps {
  pledge: PledgeRow
  giving: ContactGiving
  refs?: GivingRefs | null
  className?: string
}

/** Pledge card: progress bar, balance, next installment (05 §2). */
export function PledgeCard({ pledge, giving, refs, className }: PledgeCardProps) {
  // With gifts read through the redacted view there is no paid figure, so the
  // bar would read a misleading 0% — show the schedule without the arithmetic.
  const hideProgress = giving.amountsHidden
  const total = pledge.amount_gbp ?? pledge.total_amount
  const paid = paidOf(pledge, giving)
  const written = pledge.write_off_amount ?? 0
  const balance = Math.max(0, total - paid - written)
  const next = nextInstallment(pledge, giving.installments)
  const label = pledge.campaign_id ? refs?.campaigns[pledge.campaign_id] : null
  const fund = pledge.fund_id ? refs?.funds[pledge.fund_id] : null

  return (
    <div className={cn('flex flex-col gap-[6px] rounded-card border border-border bg-surface p-[14px]', className)}>
      <SectionLabel>Open pledge</SectionLabel>
      <div className="text-[13px]">
        {label ?? fund ?? 'Pledge'} · <Money amount={total} /> pledged
      </div>
      {hideProgress ? null : (
        <div className="flex items-center gap-2">
          <ProgressBar
            value={total > 0 ? paid / total : 0}
            label={`${formatMoney(paid)} of ${formatMoney(total)} paid`}
            className="grow"
          />
          <span className="tabular shrink-0 text-[12px] text-muted">
            {formatMoney(paid)} / {formatMoney(total)}
          </span>
        </div>
      )}
      <div className="text-[12.5px] text-muted">
        {hideProgress ? null : (
          <>
            Balance <Money amount={balance} bold={false} className="font-semibold" />
          </>
        )}
        {next ? (
          <>
            {hideProgress ? 'Next installment ' : ' · Next installment '}
            {formatMoney(next.amount)} ·{' '}
            <span className={cn(isPastDay(next.due_on) && 'font-semibold text-flag-overdue')}>
              {formatDate(next.due_on)}
            </span>
          </>
        ) : null}
      </div>
    </div>
  )
}

export interface GivingTabProps {
  giving: ContactGiving | undefined
  stats: ContactStats | null
  refs?: GivingRefs | null
  loading?: boolean
  /** Entry needs the donor: the sheets open prefilled from the profile (05 §1). */
  contactId?: string
  contactName?: string
  /** Viewers read; fundraiser+ create (11 §1). */
  readOnly?: boolean
}

/**
 * The Giving tab (04 §5.3). Entry happens in the M4 sheets (05 §1–2): "Record
 * gift" opens gift entry prefilled with this donor — with their ask array, the
 * Gift Aid line and any open pledge offered in the applies-to banner — and the
 * ⋯ menu carries pledges and standing orders.
 */
export function GivingTab({
  giving,
  stats,
  refs,
  loading,
  contactId,
  contactName,
  readOnly,
}: GivingTabProps) {
  const [giftOpen, setGiftOpen] = useState(false)
  const [pledgeOpen, setPledgeOpen] = useState(false)
  const [recurringOpen, setRecurringOpen] = useState(false)

  if (loading) return <p className="py-8 text-center text-[13px] text-muted">Loading giving history…</p>
  if (!giving) return null

  const openPledges = giving.pledges.filter((p) => p.status === 'open')
  const { amountsHidden } = giving

  // The profile already spends 330px on the right rail, so the rollups only
  // sit beside the gifts table on very wide screens.
  return (
    <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start">
      <div className="flex min-w-0 grow flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel as="h2">Gifts</SectionLabel>
          {readOnly || !contactId ? null : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setGiftOpen(true)}>
                Record gift
              </Button>
              <Menu
                label="More giving actions"
                trigger="⋯"
                triggerClassName="min-h-[28px] px-[9px] py-0 text-[12px]"
                items={[
                  { id: 'pledge', label: 'Record a pledge', onSelect: () => setPledgeOpen(true) },
                  { id: 'recurring', label: 'New standing order', onSelect: () => setRecurringOpen(true) },
                ]}
              />
            </div>
          )}
        </div>

        {/* The sheets render through a portal, so their position here is layout-neutral. */}
        {contactId ? (
          <>
            <GiftSheet
              open={giftOpen}
              onClose={() => setGiftOpen(false)}
              contactId={contactId}
              contactName={contactName}
            />
            <PledgeSheet
              open={pledgeOpen}
              onClose={() => setPledgeOpen(false)}
              contactId={contactId}
              contactName={contactName}
            />
            <RecurringSheet
              open={recurringOpen}
              onClose={() => setRecurringOpen(false)}
              contactId={contactId}
              contactName={contactName}
            />
          </>
        ) : null}

        {amountsHidden ? (
          <p className="rounded-input bg-row px-3 py-2 text-[12.5px] text-muted">
            Amounts are hidden for your role — the gift history, coding and follow-up state are shown
            without them (11 §2).
          </p>
        ) : null}

        {giving.donations.length === 0 ? (
          <EmptyState
            title="No gifts recorded yet"
            hint="Gifts show date, amount, the three coding axes (fund · campaign · appeal), and their receipt, thank-you and Gift Aid state."
          />
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
            <table className="tabular w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold tracking-[0.06em] text-muted uppercase">
                  <th className="px-3 py-[10px]">Date</th>
                  {amountsHidden ? null : <th className="px-3 py-[10px]">Amount</th>}
                  <th className="px-3 py-[10px]">Fund · campaign · appeal</th>
                  <th className="px-3 py-[10px]">Method</th>
                  <th className="px-3 py-[10px]">Receipt</th>
                  <th className="px-3 py-[10px]">Thanked</th>
                  <th className="px-3 py-[10px]">Gift Aid</th>
                </tr>
              </thead>
              <tbody>
                {giving.donations.map((gift) => (
                  <tr key={gift.id} className="border-t border-row">
                    <td className="px-3 py-[10px] whitespace-nowrap">{formatDate(gift.donated_on)}</td>
                    {amountsHidden ? null : (
                      <td className="px-3 py-[10px]">
                        <Money amount={gift.amount_gbp ?? gift.amount} />
                      </td>
                    )}
                    <td className="px-3 py-[10px] text-muted">
                      {[
                        gift.fund_id ? refs?.funds[gift.fund_id] : null,
                        gift.campaign_id ? refs?.campaigns[gift.campaign_id] : null,
                        gift.appeal_id ? refs?.appeals[gift.appeal_id] : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td className="px-3 py-[10px] text-muted">{humanise(gift.payment_method)}</td>
                    <td className={cn('px-3 py-[10px]', STATUS_TONE[gift.receipt_status] ?? 'text-muted')}>
                      {humanise(gift.receipt_status)}
                    </td>
                    <td className={cn('px-3 py-[10px]', STATUS_TONE[gift.thank_you_status] ?? 'text-muted')}>
                      {humanise(gift.thank_you_status)}
                    </td>
                    <td className={cn('px-3 py-[10px]', STATUS_TONE[gift.gift_aid_status] ?? 'text-muted')}>
                      {humanise(gift.gift_aid_status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {openPledges.map((pledge) => (
          <PledgeCard key={pledge.id} pledge={pledge} giving={giving} refs={refs} />
        ))}

        {giving.recurring.map((agreement) => {
          const failing = agreement.status === 'failing'
          return (
            <div
              key={agreement.id}
              className={cn(
                'flex flex-col gap-[6px] rounded-card border bg-surface p-[14px]',
                failing ? 'border-flag-overdue' : 'border-border',
              )}
            >
              <SectionLabel tone={failing ? 'overdue' : 'muted'}>Recurring agreement</SectionLabel>
              {failing ? (
                <p className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] font-semibold text-flag-overdue">
                  Standing order failing — {formatNumber(agreement.missed_count)} missed. Call, don’t email.
                </p>
              ) : null}
              <div className="text-[13px]">
                <Money amount={agreement.amount} /> {agreement.frequency} ·{' '}
                {humanise(agreement.payment_method)}
              </div>
              <div className="text-[12.5px] text-muted">
                <Pill variant="computed" tone={failing ? 'overdue' : 'neutral'}>
                  {humanise(agreement.status)}
                </Pill>{' '}
                {agreement.last_payment_on ? `last payment ${formatDate(agreement.last_payment_on)}` : null}
              </div>
            </div>
          )
        })}
      </div>

      {/* Rollup sidebar — the header numbers expanded, hard vs soft in parallel. */}
      <aside className="flex w-full shrink-0 flex-col gap-[6px] rounded-card border border-border bg-surface p-[14px] 2xl:w-[280px]">
        <SectionLabel>Rollups</SectionLabel>

        {amountsHidden ? (
          <p className="text-[12.5px] text-muted">Giving totals are hidden for your role (11 §2).</p>
        ) : (
          <>
            <Rollup label="Lifetime (hard credit)" value={stats?.lifetime_giving} />
            <Rollup label="This year" value={stats?.this_year_giving} />
            <Rollup label="Last year" value={stats?.last_year_giving} />
            <Rollup label="Largest gift" value={stats?.largest_gift} />
            <Rollup label="Average gift" value={stats?.average_gift} />
          </>
        )}

        {/* Counts and dates are not amounts — they stay for every role. */}
        <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
          <span className="text-muted">Gifts</span>
          <span className="tabular font-semibold">{formatNumber(stats?.gift_count ?? null)}</span>
        </div>
        <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
          <span className="text-muted">First gift</span>
          <span className="tabular">{stats?.first_gift_on ? formatDate(stats.first_gift_on) : '—'}</span>
        </div>

        {amountsHidden ? null : (
          <>
            <hr className="my-1 border-border" />
            <p className="text-[11.5px] text-faint">
              Soft credit is tracked in parallel and never added to financial totals (02 D2).
            </p>
            <Rollup label="Soft credit — lifetime" value={stats?.soft_credit_lifetime} muted />
            <Rollup label="Soft credit — this year" value={stats?.soft_credit_this_year} muted />
            <hr className="my-1 border-border" />
            <Rollup label="Pledge balance" value={stats?.pledge_balance} />
          </>
        )}
      </aside>
    </div>
  )
}

function Rollup({ label, value, muted }: { label: string; value: number | null | undefined; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
      <span className="text-muted">{label}</span>
      <Money amount={value ?? null} muted={muted} className="text-[13px]" />
    </div>
  )
}
