import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Button,
  EmptyState,
  Field,
  MetricCard,
  Money,
  Pill,
  SectionLabel,
  Tabs,
  TextArea,
  TextInput,
  useToast,
  useUndoToast,
} from '../../components'
import { cn } from '../../lib/cn'
import { toISODate } from '../../lib/dates'
import { formatDate, formatMoney, formatNumber } from '../../lib/format'
import { useGivingRefs } from '../../lib/queries/contacts'
import {
  useGivingBoard,
  useMarkThanked,
  useSetPledgeStatus,
  useSetReceiptStatus,
  useSetRecurringStatus,
  useUnmarkThanked,
} from '../../lib/queries/giving'
import { useTeamMember } from '../auth/useTeamMember'
import { PageHeader } from '../shell/PageHeader'
import { displayName } from '../contacts/normalise'
import { ConfirmDialog } from './ConfirmDialog'
import { GiftSheet, type GiftSheetPreset } from './GiftSheet'
import { PledgeCard } from './PledgeCard'
import { PledgeSheet } from './PledgeSheet'
import { RecurringCard } from './RecurringCard'
import { RecurringSheet } from './RecurringSheet'
import { downloadCsv } from './download'
import {
  codingLine,
  givingMetrics,
  humanise,
  needsReceipts,
  needsThanks,
  parseAmount,
  pledgeProgress,
  receiptCsv,
  THANKS_TARGET_HOURS,
  type QueueRow,
} from './logic'
import { EMPTY_BOARD, type PledgeRow, type RecurringAgreementRow } from './types'

type GivingTab = 'gifts' | 'thanks' | 'receipts' | 'pledges' | 'recurring'

const STATUS_TONE: Record<string, 'good' | 'accent' | 'today' | 'neutral' | 'gold'> = {
  sent: 'good',
  done: 'good',
  claimed: 'good',
  eligible: 'accent',
  queued: 'today',
  task_open: 'today',
  pending_declaration: 'today',
  not_sent: 'neutral',
  not_done: 'neutral',
  not_required: 'neutral',
  ineligible: 'neutral',
}

const StatusPill = ({ value }: { value: string | null | undefined }) =>
  value ? <Pill tone={STATUS_TONE[value] ?? 'neutral'}>{humanise(value)}</Pill> : <span className="text-faint">—</span>

/**
 * The Giving screen (05 §1–§4): what came in, what was promised, what still
 * needs thanking and receipting, and which standing orders have stopped.
 *
 * Everything downstream of a gift — thank-you tasks, receipt queueing, Gift Aid
 * status — is written by database triggers (08 §2). This screen records, marks
 * and reflects; it never simulates the automation.
 */
export function GivingView() {
  const board = useGivingBoard()
  const refs = useGivingRefs()
  const member = useTeamMember()
  const toast = useToast()
  const withUndo = useUndoToast()

  const markThanked = useMarkThanked()
  const unmarkThanked = useUnmarkThanked()
  const setReceipt = useSetReceiptStatus()
  const setPledgeStatus = useSetPledgeStatus()
  const setRecurringStatus = useSetRecurringStatus()

  const [tab, setTab] = useState<GivingTab>('gifts')
  const [giftOpen, setGiftOpen] = useState(false)
  const [giftPreset, setGiftPreset] = useState<{ contactId?: string; contactName?: string; preset?: GiftSheetPreset }>({})
  const [pledgeOpen, setPledgeOpen] = useState(false)
  const [recurringOpen, setRecurringOpen] = useState(false)
  const [writeOff, setWriteOff] = useState<{ pledge: PledgeRow; balance: number } | null>(null)
  const [cancelPledge, setCancelPledge] = useState<PledgeRow | null>(null)
  const [cancelRecurring, setCancelRecurring] = useState<RecurringAgreementRow | null>(null)
  const [exportOpen, setExportOpen] = useState(false)

  const data = board.data ?? EMPTY_BOARD
  const readOnly = member.data?.role === 'viewer'
  const isAdmin = member.data?.role === 'admin'
  /** 11 §2: the ledger arrived through the redacted view — no money to render. */
  const amountsHidden = data.amountsHidden
  const money = (amount: number | null) => (amountsHidden ? '—' : formatMoney(amount))

  const metrics = useMemo(() => givingMetrics(data), [data])
  const thanksQueue = useMemo(() => needsThanks(data), [data])
  const receiptQueue = useMemo(() => needsReceipts(data), [data])
  const openPledges = useMemo(
    () => data.pledges.filter((pledge) => pledge.status === 'open'),
    [data.pledges],
  )
  const closedPledges = useMemo(
    () => data.pledges.filter((pledge) => pledge.status !== 'open'),
    [data.pledges],
  )

  function openGift(next: { contactId?: string; contactName?: string; preset?: GiftSheetPreset }) {
    setGiftPreset(next)
    setGiftOpen(true)
  }

  function thank(row: QueueRow) {
    void withUndo({
      message: `Thanked — ${formatMoney(row.gift.amount_gbp ?? row.gift.amount)}${
        row.contact ? ` from ${displayName(row.contact)}` : ''
      }`,
      tone: 'good',
      perform: () => markThanked.mutateAsync({ gift: row.gift }),
      undo: (result) => unmarkThanked.mutateAsync({ gift: row.gift, result }),
    })
  }

  function markSent(row: QueueRow) {
    const previous = row.gift.receipt_status
    void withUndo({
      message: 'Receipt marked sent',
      tone: 'good',
      perform: () => setReceipt.mutateAsync({ gift: row.gift, status: 'sent' }),
      undo: () => setReceipt.mutateAsync({ gift: row.gift, status: previous }),
    })
  }

  function exportReceipts() {
    const csv = receiptCsv(receiptQueue, refs.data?.funds ?? {})
    downloadCsv(`receipts-${toISODate(new Date())}.csv`, csv)
    setExportOpen(false)
    toast.push(`Exported ${receiptQueue.length} receipt${receiptQueue.length === 1 ? '' : 's'} for merge`, {
      tone: 'good',
    })
  }

  function confirmWriteOff(amount: number | null, reason: string) {
    if (!writeOff) return
    const { pledge } = writeOff
    setWriteOff(null)
    void setPledgeStatus
      .mutateAsync({
        pledge,
        status: 'written_off',
        writeOffAmount: amount,
        reason: reason.trim() === '' ? null : reason.trim(),
      })
      .then(() => toast.push('Pledge written off — the history stays on the record', { tone: 'neutral' }))
  }

  function confirmCancelPledge() {
    if (!cancelPledge) return
    const pledge = cancelPledge
    setCancelPledge(null)
    void setPledgeStatus
      .mutateAsync({ pledge, status: 'cancelled', reason: 'cancelled from the Giving screen' })
      .then(() => toast.push('Pledge cancelled', { tone: 'neutral' }))
  }

  function confirmCancelRecurring() {
    if (!cancelRecurring) return
    const agreement = cancelRecurring
    setCancelRecurring(null)
    void setRecurringStatus
      .mutateAsync({ agreement, status: 'cancelled' })
      .then(() => toast.push('Standing order cancelled', { tone: 'neutral' }))
  }

  const tabs: Array<{ id: GivingTab; label: string }> = [
    { id: 'gifts', label: `Recent gifts · ${data.gifts.length}` },
    { id: 'thanks', label: `Needs thanks · ${thanksQueue.length}` },
    { id: 'receipts', label: `Needs receipts · ${receiptQueue.length}` },
    { id: 'pledges', label: `Pledges · ${openPledges.length}` },
    { id: 'recurring', label: `Recurring · ${data.recurring.length}` },
  ]

  return (
    <>
      <PageHeader
        title="Giving"
        subtitle="Gifts, pledges, standing orders — thanked, receipted and coded on all three axes"
        actions={
          readOnly ? undefined : (
            <>
              <Button onClick={() => openGift({})}>＋ Record gift</Button>
              <Button variant="outline" onClick={() => setPledgeOpen(true)}>
                Record pledge
              </Button>
            </>
          )
        }
      />

      {amountsHidden ? (
        <p className="mb-3 rounded-input bg-row px-3 py-2 text-[12.5px] text-muted">
          Amounts are hidden for your role — the ledger, its coding and the follow-up state are shown without
          them (11 §2).
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="This month"
          tone="gold"
          value={money(metrics.monthTotal)}
          caption={`${formatNumber(metrics.monthCount)} gift${metrics.monthCount === 1 ? '' : 's'}`}
        />
        <MetricCard
          label="This year"
          tone="gold"
          value={money(metrics.yearTotal)}
          caption={`${formatNumber(metrics.yearCount)} gift${metrics.yearCount === 1 ? '' : 's'}`}
        />
        <MetricCard
          label="Pledges outstanding"
          tone="gold"
          value={money(metrics.pledgeBalance)}
          caption={`${openPledges.length} open`}
          onClick={() => setTab('pledges')}
        />
        <MetricCard
          label="Failing recurring"
          tone={metrics.failingRecurring > 0 ? 'overdue' : 'ink'}
          value={formatNumber(metrics.failingRecurring)}
          caption={metrics.failingRecurring > 0 ? 'call, don’t email' : 'all collecting'}
          onClick={() => setTab('recurring')}
        />
      </div>

      <Tabs aria-label="Giving sections" items={tabs} active={tab} onChange={setTab} className="mb-4" />

      {board.isLoading && !board.data ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[52px] animate-pulse rounded-card border border-border bg-surface" />
          ))}
        </div>
      ) : null}

      {board.error ? (
        <p role="alert" className="rounded-card bg-[#FBECEC] px-4 py-3 text-[13px] text-flag-overdue">
          The ledger could not be read: {board.error instanceof Error ? board.error.message : 'unknown error'}
        </p>
      ) : null}

      {tab === 'gifts' ? (
        data.gifts.length === 0 && !board.isLoading ? (
          <EmptyState
            title="No gifts in the last 18 months"
            hint="Recorded gifts show their three coding axes (fund · campaign · appeal) and their receipt, thank-you and Gift Aid state."
            action={
              readOnly ? undefined : <Button onClick={() => openGift({})}>Record the first gift</Button>
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-surface">
            <table className="tabular w-full min-w-[880px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border text-left text-[11.5px] tracking-[0.05em] text-muted uppercase">
                  <th className="px-3 py-2 font-semibold">Date</th>
                  <th className="px-3 py-2 font-semibold">Donor</th>
                  {amountsHidden ? null : <th className="px-3 py-2 font-semibold">Amount</th>}
                  <th className="px-3 py-2 font-semibold">Fund · campaign · appeal</th>
                  <th className="px-3 py-2 font-semibold">Method</th>
                  <th className="px-3 py-2 font-semibold">Receipt</th>
                  <th className="px-3 py-2 font-semibold">Thanked</th>
                  <th className="px-3 py-2 font-semibold">Gift Aid</th>
                </tr>
              </thead>
              <tbody>
                {data.gifts.map((gift) => {
                  const contact = data.contacts[gift.contact_id] ?? null
                  return (
                    <tr key={gift.id} className="border-b border-row last:border-b-0">
                      <td className="px-3 py-2 whitespace-nowrap">{formatDate(gift.donated_on)}</td>
                      <td className="px-3 py-2">
                        {contact ? (
                          <Link
                            to={`/contacts/${contact.id}`}
                            className="font-semibold text-accent-dark hover:underline"
                          >
                            {displayName(contact)}
                          </Link>
                        ) : (
                          <span className="text-muted">Unknown donor</span>
                        )}
                      </td>
                      {amountsHidden ? null : (
                        <td className="px-3 py-2">
                          <Money amount={gift.amount_gbp ?? gift.amount} />
                          {gift.currency !== 'GBP' && gift.amount !== null ? (
                            <span className="ml-1 text-[11.5px] text-muted">
                              ({gift.currency} {gift.amount})
                            </span>
                          ) : null}
                          {gift.is_gasds ? (
                            <span className="ml-1 text-[11.5px] text-muted">GASDS</span>
                          ) : null}
                        </td>
                      )}
                      <td className="px-3 py-2 text-muted">{codingLine(gift, refs.data)}</td>
                      <td className="px-3 py-2 text-muted">{humanise(gift.payment_method)}</td>
                      <td className="px-3 py-2">
                        <StatusPill value={gift.receipt_status} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill value={gift.thank_you_status} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill value={gift.gift_aid_status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : null}

      {tab === 'thanks' ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-accent bg-accent-soft px-4 py-3">
            <p className="text-[13px] text-accent-dark">
              <b className="text-[15px]">{THANKS_TARGET_HOURS}h</b> — the thank-you norm. Big gifts (
              {formatMoney(500)}+) are flagged and route to the relationship owner (08 §2).
            </p>
            <span className="text-[12.5px] text-accent-dark">
              {thanksQueue.length} waiting · {thanksQueue.filter((row) => row.pastTarget).length} past the norm
            </span>
          </div>
          <QueueTable
            rows={thanksQueue}
            emptyTitle="Every gift is thanked"
            emptyHint="New gifts appear here the moment they are recorded — the database opens the thank-you task."
            refsFunds={refs.data?.funds ?? {}}
            actionLabel="Mark thanked"
            readOnly={readOnly}
            amountsHidden={amountsHidden}
            onAction={thank}
            showDaysColumn
          />
        </section>
      ) : null}

      {tab === 'receipts' ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SectionLabel as="h2">
              Unreceipted gifts · {receiptQueue.length} ·{' '}
              {money(receiptQueue.reduce((sum, row) => sum + (row.gift.amount_gbp ?? row.gift.amount ?? 0), 0))}
            </SectionLabel>
            <Button
              variant="outline"
              disabled={receiptQueue.length === 0 || amountsHidden}
              title={amountsHidden ? 'The export carries amounts, which are hidden for your role' : undefined}
              onClick={() => setExportOpen(true)}
            >
              Export CSV
            </Button>
          </div>
          <QueueTable
            rows={receiptQueue}
            emptyTitle="Nothing waiting for a receipt"
            emptyHint="Receipts are queued per the preference cascade (gift → donor → system) when a gift saves."
            refsFunds={refs.data?.funds ?? {}}
            actionLabel="Mark sent"
            readOnly={readOnly}
            amountsHidden={amountsHidden}
            onAction={markSent}
          />
        </section>
      ) : null}

      {tab === 'pledges' ? (
        <section className="flex flex-col gap-3">
          {openPledges.length === 0 ? (
            <EmptyState
              title="No open pledges"
              hint="A pledge holds the promise, its schedule and its balance; payments are ordinary gifts applied to an installment."
              action={
                readOnly ? undefined : <Button onClick={() => setPledgeOpen(true)}>Record a pledge</Button>
              }
            />
          ) : null}
          {openPledges.map((pledge) => (
            <PledgeCard
              key={pledge.id}
              pledge={pledge}
              contact={data.contacts[pledge.contact_id] ?? null}
              donations={data.gifts}
              installments={data.installments}
              refs={refs.data}
              balance={data.balances[pledge.id] ?? null}
              readOnly={readOnly}
              amountsHidden={amountsHidden}
              canWriteOff={isAdmin}
              onRecordPayment={(target, installment) => {
                const progress = pledgeProgress(
                  target,
                  { donations: data.gifts, installments: data.installments },
                  new Date(),
                  data.balances[target.id] ?? null,
                )
                const contact = data.contacts[target.contact_id] ?? null
                openGift({
                  contactId: target.contact_id,
                  contactName: contact ? displayName(contact) : undefined,
                  preset: {
                    pledgeId: target.id,
                    installmentId: installment?.id ?? null,
                    amount: installment?.amount ?? progress.balance,
                    fundId: target.fund_id,
                    campaignId: target.campaign_id,
                    appealId: target.appeal_id,
                  },
                })
              }}
              onWriteOff={(target) =>
                setWriteOff({
                  pledge: target,
                  balance: pledgeProgress(
                    target,
                    { donations: data.gifts, installments: data.installments },
                    new Date(),
                    data.balances[target.id] ?? null,
                  ).balance,
                })
              }
              onCancel={setCancelPledge}
            />
          ))}

          {closedPledges.length > 0 ? (
            <>
              <SectionLabel as="h2" className="mt-2">
                Closed · {closedPledges.length}
              </SectionLabel>
              {closedPledges.map((pledge) => (
                <PledgeCard
                  key={pledge.id}
                  pledge={pledge}
                  contact={data.contacts[pledge.contact_id] ?? null}
                  donations={data.gifts}
                  installments={data.installments}
                  refs={refs.data}
                  balance={data.balances[pledge.id] ?? null}
                  readOnly
                  amountsHidden={amountsHidden}
                />
              ))}
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'recurring' ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel as="h2">Standing orders · {data.recurring.length}</SectionLabel>
            {readOnly ? null : (
              <Button variant="outline" onClick={() => setRecurringOpen(true)}>
                ＋ New standing order
              </Button>
            )}
          </div>
          {data.recurring.length === 0 ? (
            <EmptyState
              title="No recurring agreements yet"
              hint="Standing orders live here with their last payment and failing state — a missed payment is a retention emergency."
            />
          ) : null}
          {data.recurring.map((agreement) => (
            <RecurringCard
              key={agreement.id}
              agreement={agreement}
              contact={data.contacts[agreement.contact_id] ?? null}
              refs={refs.data}
              readOnly={readOnly}
              onRecordPayment={(target) => {
                const contact = data.contacts[target.contact_id] ?? null
                openGift({
                  contactId: target.contact_id,
                  contactName: contact ? displayName(contact) : undefined,
                  preset: {
                    recurringId: target.id,
                    amount: target.amount,
                    fundId: target.fund_id,
                  },
                })
              }}
              onPause={(target) =>
                void withUndo({
                  message: 'Standing order paused',
                  perform: () => setRecurringStatus.mutateAsync({ agreement: target, status: 'paused' }),
                  undo: () =>
                    setRecurringStatus.mutateAsync({ agreement: target, status: target.status }),
                })
              }
              onReactivate={(target) =>
                void withUndo({
                  message: 'Standing order reactivated',
                  tone: 'good',
                  perform: () => setRecurringStatus.mutateAsync({ agreement: target, status: 'active' }),
                  undo: () =>
                    setRecurringStatus.mutateAsync({ agreement: target, status: target.status }),
                })
              }
              onCancel={setCancelRecurring}
            />
          ))}
        </section>
      ) : null}

      {/* TODO(M5+): funds, campaigns and appeals are managed in Settings (05 §4);
          this screen only selects them and shows their names. */}

      <GiftSheet
        open={giftOpen}
        onClose={() => setGiftOpen(false)}
        contactId={giftPreset.contactId}
        contactName={giftPreset.contactName}
        preset={giftPreset.preset}
      />
      <PledgeSheet open={pledgeOpen} onClose={() => setPledgeOpen(false)} />
      <RecurringSheet open={recurringOpen} onClose={() => setRecurringOpen(false)} />

      {writeOff ? (
        <WriteOffDialog
          balance={writeOff.balance}
          pending={setPledgeStatus.isPending}
          onClose={() => setWriteOff(null)}
          onConfirm={confirmWriteOff}
        />
      ) : null}

      <ConfirmDialog
        open={cancelPledge !== null}
        onClose={() => setCancelPledge(null)}
        onConfirm={confirmCancelPledge}
        title="Cancel this pledge?"
        confirmLabel="Cancel the pledge"
        pending={setPledgeStatus.isPending}
      >
        <p>
          Cancelling keeps the record and its payments but stops the schedule and the chase tasks. Use
          write-off when the money was genuinely promised and will not arrive.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={cancelRecurring !== null}
        onClose={() => setCancelRecurring(null)}
        onConfirm={confirmCancelRecurring}
        title="Cancel this standing order?"
        confirmLabel="Cancel it"
        pending={setRecurringStatus.isPending}
      >
        <p>
          The agreement stops being expected, so no more missed-payment signals. Past payments stay on the
          donor's record.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        onConfirm={exportReceipts}
        title="Export the receipt queue?"
        confirmLabel={`Export ${receiptQueue.length} row${receiptQueue.length === 1 ? '' : 's'}`}
        tone="primary"
      >
        <p>
          This downloads a CSV of the {receiptQueue.length} queued receipt
          {receiptQueue.length === 1 ? '' : 's'} — donor, address, postcode, gift date and amount — for a Word
          mail merge. Data leaves the system, so it asks first (03 §5.2).
        </p>
        <p className="text-muted">Marking them sent stays a separate, per-row action.</p>
      </ConfirmDialog>
    </>
  )
}

interface WriteOffDialogProps {
  balance: number
  pending?: boolean
  onClose: () => void
  onConfirm: (amount: number | null, reason: string) => void
}

/**
 * Write-off (05 §2, admin only): amount + reason behind a confirm, because the
 * pledge's balance goes to zero and the chase stops — an irreversible write,
 * not an undoable one (I-12).
 *
 * Its own component so typing does not re-render the whole screen; the dialog
 * re-mounts per pledge, which also re-seeds the amount with the balance due.
 */
function WriteOffDialog({ balance, pending, onClose, onConfirm }: WriteOffDialogProps) {
  const [amount, setAmount] = useState(() => String(balance))
  const [reason, setReason] = useState('')

  return (
    <ConfirmDialog
      open
      onClose={onClose}
      onConfirm={() => onConfirm(parseAmount(amount), reason)}
      title="Write off this pledge?"
      confirmLabel="Write it off"
      pending={pending}
    >
      <p>
        The pledge stays on the record with its history; the balance goes to zero and it stops chasing
        (05 §2). This cannot be undone from here — reopening one is an admin database change.
      </p>
      <Field label="Amount written off" required>
        <TextInput
          inputMode="decimal"
          aria-label="Amount written off"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Field label="Reason" hint="Kept with the pledge so the history explains itself.">
        <TextArea
          rows={2}
          aria-label="Write-off reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </Field>
    </ConfirmDialog>
  )
}

interface QueueTableProps {
  rows: QueueRow[]
  emptyTitle: string
  emptyHint: string
  refsFunds: Record<string, string>
  actionLabel: string
  readOnly?: boolean
  amountsHidden?: boolean
  onAction: (row: QueueRow) => void
  showDaysColumn?: boolean
}

/** The two queues share one table — same rows, one different verb (05 §3). */
function QueueTable({
  rows,
  emptyTitle,
  emptyHint,
  refsFunds,
  actionLabel,
  readOnly,
  amountsHidden,
  onAction,
  showDaysColumn,
}: QueueTableProps) {
  if (rows.length === 0) return <EmptyState title={emptyTitle} hint={emptyHint} />

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="tabular w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11.5px] tracking-[0.05em] text-muted uppercase">
            <th className="px-3 py-2 font-semibold">Gift</th>
            <th className="px-3 py-2 font-semibold">Donor</th>
            <th className="px-3 py-2 font-semibold">Date</th>
            <th className="px-3 py-2 font-semibold">{showDaysColumn ? 'Days since' : 'Waiting'}</th>
            <th className="px-3 py-2 font-semibold">Fund</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.gift.id} className="border-b border-row last:border-b-0">
              <td className="px-3 py-2">
                {amountsHidden ? (
                  <span className="text-muted">Gift {formatDate(row.gift.donated_on)}</span>
                ) : (
                  <Money amount={row.gift.amount_gbp ?? row.gift.amount} />
                )}
                {row.isBig ? (
                  <Pill variant="manual" tone="gold" className="ml-2">
                    Big gift
                  </Pill>
                ) : null}
              </td>
              <td className="px-3 py-2">
                {row.contact ? (
                  <Link
                    to={`/contacts/${row.contact.id}`}
                    className="font-semibold text-accent-dark hover:underline"
                  >
                    {displayName(row.contact)}
                  </Link>
                ) : (
                  <span className="text-muted">Unknown donor</span>
                )}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted">{formatDate(row.gift.donated_on)}</td>
              <td
                className={cn(
                  'px-3 py-2',
                  row.pastTarget ? 'font-semibold text-flag-overdue' : 'text-muted',
                )}
              >
                {row.daysSince}d
              </td>
              <td className="px-3 py-2 text-muted">
                {row.gift.fund_id ? (refsFunds[row.gift.fund_id] ?? '—') : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                {readOnly ? null : (
                  <Button size="sm" variant="outline" onClick={() => onAction(row)}>
                    {actionLabel}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
