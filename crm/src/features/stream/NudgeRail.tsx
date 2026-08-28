import { Link, useNavigate } from 'react-router'
import { Button, Menu, NudgeCard, SectionLabel, useUndoToast } from '../../components'
import { cn } from '../../lib/cn'
import { formatMoney } from '../../lib/format'
import { snoozedDueOn } from '../tasks/logic'
import { usePledgeSummary, useSignals, useUpdateSignal } from '../../lib/queries/signals'
import { waNumber } from '../contacts/normalise'
import { nudgeRank, nudgeSpec } from './nudges'
import type { SignalRow, SignalWithContact } from './types'

export interface NudgeRailProps {
  /** Create a next action for this contact (the "schedule" verbs). */
  onCreateTask: (contactId: string, contactName: string, actionType?: string) => void
  /** Hide money on the pledge card for restricted viewers (11 §2). */
  canSeeAmounts?: boolean
  className?: string
}

/**
 * The rail (04 §1): one card per open signal, sorted red → orange → gold →
 * teal, plus the overdue-pledge summary. Act / snooze / dismiss are optimistic
 * with an undo toast; nothing auto-dismisses (03 §5.3).
 *
 * On mobile the rail folds into the stream — the same cards, stacked under the
 * sections (04 §1 mobile).
 */
export function NudgeRail({ onCreateTask, canSeeAmounts = true, className }: NudgeRailProps) {
  const navigate = useNavigate()
  const withUndo = useUndoToast()
  const signals = useSignals()
  const pledges = usePledgeSummary(canSeeAmounts)
  const update = useUpdateSignal()

  const items = [...(signals.data?.items ?? [])].sort(
    (a, b) => nudgeRank(a.signal.rule_key) - nudgeRank(b.signal.rule_key),
  )
  const pledge = pledges.data
  const hasPledgeCard = Boolean(pledge && pledge.overdueCount > 0)

  const transition = (item: SignalWithContact, patch: Parameters<typeof update.mutate>[0]['patch'], message: string) => {
    const before: SignalRow = item.signal
    void withUndo({
      message,
      perform: () => update.mutateAsync({ id: before.id, patch }),
      undo: () =>
        update.mutateAsync({
          id: before.id,
          patch: { state: before.state, snoozed_until: before.snoozed_until, resolved_at: before.resolved_at },
        }),
    })
  }

  if (signals.data?.error && items.length === 0 && !hasPledgeCard) return null
  if (items.length === 0 && !hasPledgeCard) return null

  return (
    <aside className={cn('flex flex-col gap-[10px]', className)} aria-label="Needs attention">
      <SectionLabel>Needs attention</SectionLabel>

      {items.map((item) => {
        const spec = nudgeSpec(item.signal.rule_key)
        const contact = item.contact
        const wa = waNumber(contact?.whatsapp ?? contact?.phone)
        const primary =
          spec.primary === 'call' && contact?.phone ? (
            <a
              href={`tel:${contact.phone}`}
              onClick={() =>
                transition(item, { state: 'acted', resolved_at: new Date().toISOString() }, 'Marked as acted')
              }
              className="inline-flex items-center rounded-[7px] bg-accent px-3 py-[5px] text-[12px] font-semibold text-surface hover:bg-accent-dark"
            >
              {spec.primaryLabel}
            </a>
          ) : spec.primary === 'task' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreateTask(item.signal.contact_id, item.contactName, spec.actionType)}
            >
              {spec.primaryLabel}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => navigate(`/contacts/${item.signal.contact_id}`)}>
              {spec.primaryLabel}
            </Button>
          )

        return (
          <NudgeCard
            key={item.signal.id}
            accent={spec.accent}
            title={spec.title}
            why={item.signal.reason}
            actions={
              <>
                {primary}
                {wa && spec.primary === 'call' ? (
                  <a
                    href={`https://wa.me/${wa}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[7px] border border-border px-3 py-[5px] text-[12px] font-semibold text-nav hover:border-faint"
                  >
                    WhatsApp
                  </a>
                ) : null}
                <Menu
                  label={`Snooze ${item.contactName}`}
                  trigger="Snooze"
                  triggerClassName="min-h-[28px] border-none px-1 py-0 text-[12px] font-medium text-muted"
                  items={[
                    {
                      id: 'tomorrow',
                      label: 'Tomorrow',
                      onSelect: () =>
                        transition(
                          item,
                          { state: 'snoozed', snoozed_until: snoozedDueOn(1) },
                          'Snoozed until tomorrow',
                        ),
                    },
                    {
                      id: 'week',
                      label: 'Next week',
                      onSelect: () =>
                        transition(
                          item,
                          { state: 'snoozed', snoozed_until: snoozedDueOn(7) },
                          'Snoozed for a week',
                        ),
                    },
                  ]}
                />
                <button
                  type="button"
                  onClick={() =>
                    transition(
                      item,
                      { state: 'dismissed', resolved_at: new Date().toISOString() },
                      'Nudge dismissed',
                    )
                  }
                  className="px-1 py-[5px] text-[12px] text-muted hover:text-ink"
                >
                  Dismiss
                </button>
              </>
            }
          >
            <span>
              <b>{item.contactName}</b> — {item.signal.reason}
            </span>
          </NudgeCard>
        )
      })}

      {hasPledgeCard && pledge ? (
        <NudgeCard accent="none" title="Pledges">
          <span className="flex flex-col gap-1">
            <span>
              <b>
                {pledge.overdueCount} installment{pledge.overdueCount === 1 ? '' : 's'} overdue
              </b>
              {canSeeAmounts ? <> · {formatMoney(pledge.outstanding)} outstanding</> : null}
            </span>
            <Link
              to="/giving?view=pledges-outstanding"
              className="text-[12px] font-semibold text-accent hover:text-accent-dark"
            >
              Open pledge list →
            </Link>
          </span>
        </NudgeCard>
      ) : null}
    </aside>
  )
}
