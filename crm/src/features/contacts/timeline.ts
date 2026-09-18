/**
 * The merged profile timeline (04 §5.2): interactions, gifts, Gift Aid
 * declarations, notes and completed tasks in one reverse-chronological feed,
 * plus the slim "Upcoming" block (scheduled interactions + the next pledge
 * installment).
 *
 * A pure builder so the merge/sort/filter rules are testable without a client.
 */

import { formatMoney } from '../../lib/format'
import type {
  DonationRow,
  GiftAidDeclarationRow,
  GivingRefs,
  InteractionRow,
  NoteRow,
  PledgeInstallmentRow,
  TaskRow,
  TeamMemberLite,
} from './types'

export type TimelineKind = 'interaction' | 'donation' | 'gift_aid' | 'note' | 'task'
export type TimelineCategory = 'conversations' | 'giving' | 'notes' | 'other'

export interface TimelineItem {
  id: string
  kind: TimelineKind
  category: TimelineCategory
  /** ISO timestamp/date used for the reverse-chron sort. */
  at: string
  /** `Meeting` / `Donation` / `Gift Aid declaration` — the bold head. */
  kindLabel: string
  /** Rest of the meta line: author, fund/appeal, method. */
  metaParts: string[]
  /** `via quick capture` — the provenance chip (09 §2). */
  sourceLabel?: string | null
  body?: string | null
  outcome?: string | null
  /** Rendered in gold before the body text. */
  amount?: number | null
  /** Icon selector for the entry. */
  icon: 'meeting' | 'call' | 'whatsapp' | 'giving' | 'note' | 'task'
  isPrivate?: boolean
}

export interface UpcomingItem {
  id: string
  label: string
  at: string | null
  tone: 'overdue' | 'neutral'
}

export interface TimelineFeed {
  past: TimelineItem[]
  upcoming: UpcomingItem[]
}

export const TIMELINE_FILTERS: Array<{ id: 'all' | TimelineCategory; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'conversations', label: 'Conversations' },
  { id: 'giving', label: 'Giving' },
  { id: 'notes', label: 'Notes' },
]

const humanise = (value: string): string =>
  value
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())

const SOURCE_LABEL: Record<string, string> = {
  quick_capture_ai: 'via quick capture',
  email_ingest: 'via email',
  import: 'imported',
}

function interactionIcon(kind: string): TimelineItem['icon'] {
  const key = kind.toLowerCase()
  if (key.includes('whatsapp') || key.includes('sms')) return 'whatsapp'
  if (key.includes('call')) return 'call'
  return 'meeting'
}

export interface BuildTimelineInput {
  interactions?: InteractionRow[]
  donations?: DonationRow[]
  declarations?: GiftAidDeclarationRow[]
  notes?: NoteRow[]
  tasks?: TaskRow[]
  installments?: PledgeInstallmentRow[]
  refs?: GivingRefs | null
  team?: TeamMemberLite[]
  /** `interaction_kind` labels from `lookup_options` (02 §6). */
  kindLabels?: Record<string, string>
  now?: Date
}

export function buildTimeline(input: BuildTimelineInput): TimelineFeed {
  const {
    interactions = [],
    donations = [],
    declarations = [],
    notes = [],
    tasks = [],
    installments = [],
    refs = null,
    team = [],
    kindLabels = {},
    now = new Date(),
  } = input

  const nowMs = now.getTime()
  const memberName = new Map(team.map((m) => [m.id, m.full_name]))
  const past: TimelineItem[] = []
  const upcoming: UpcomingItem[] = []

  for (const row of interactions) {
    if (row.status === 'cancelled') continue
    const at = new Date(row.occurred_at).getTime()
    const label = kindLabels[row.kind] ?? humanise(row.kind)

    if (row.status === 'scheduled' && at >= nowMs) {
      upcoming.push({
        id: `interaction-${row.id}`,
        label: [label, row.purpose || row.summary, row.location ? `at ${row.location}` : null]
          .filter(Boolean)
          .join(' — '),
        at: row.occurred_at,
        tone: 'neutral',
      })
      continue
    }

    const who = row.team_member_id ? memberName.get(row.team_member_id) : null
    past.push({
      id: `interaction-${row.id}`,
      kind: 'interaction',
      category: 'conversations',
      at: row.occurred_at,
      kindLabel: label,
      metaParts: [
        who ? (row.source === 'quick_capture_ai' ? `logged by ${who}` : who) : null,
        row.location,
      ].filter((p): p is string => Boolean(p)),
      sourceLabel: row.source ? (SOURCE_LABEL[row.source] ?? null) : null,
      body: row.summary,
      outcome: [
        row.outcome ? `Outcome: ${row.outcome}` : null,
        row.ask_amount ? `Ask discussed: ${formatMoney(row.ask_amount)}` : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
      icon: interactionIcon(row.kind),
    })
  }

  for (const row of donations) {
    const fund = row.fund_id ? refs?.funds[row.fund_id] : null
    const campaign = row.campaign_id ? refs?.campaigns[row.campaign_id] : null
    const appeal = row.appeal_id ? refs?.appeals[row.appeal_id] : null
    const flags = [
      row.payment_method ? humanise(row.payment_method).toLowerCase() : null,
      row.receipt_status === 'sent' ? 'receipt sent ✓' : null,
      row.thank_you_status === 'done' ? 'thanked ✓' : null,
      row.gift_aid_status === 'claimed'
        ? 'Gift Aid claimed ✓'
        : row.gift_aid_status === 'eligible'
          ? 'Gift Aid eligible'
          : null,
    ].filter(Boolean)

    past.push({
      id: `donation-${row.id}`,
      kind: 'donation',
      category: 'giving',
      at: row.donated_on,
      kindLabel: row.status === 'received' ? 'Donation' : `Donation (${humanise(row.status).toLowerCase()})`,
      metaParts: [fund ? `${fund} fund` : null, campaign, appeal].filter((p): p is string => Boolean(p)),
      amount: row.amount_gbp ?? row.amount,
      body: flags.length > 0 ? `received — ${flags.join(' · ')}` : 'received',
      icon: 'giving',
    })
  }

  for (const row of declarations) {
    const enduring = row.covers_future ? 'enduring' : 'single gift'
    past.push({
      id: `declaration-${row.id}`,
      kind: 'gift_aid',
      category: 'giving',
      at: row.declared_on,
      kindLabel: row.cancelled_on ? 'Gift Aid declaration cancelled' : 'Gift Aid declaration',
      metaParts: [humanise(row.method).toLowerCase(), enduring],
      body: row.covers_past
        ? 'Covers future gifts and the 4 prior years.'
        : 'Covers gifts from the declaration date.',
      icon: 'note',
    })
  }

  for (const row of notes) {
    past.push({
      id: `note-${row.id}`,
      kind: 'note',
      category: 'notes',
      at: row.created_at,
      kindLabel: row.category ? `Note · ${humanise(row.category).toLowerCase()}` : 'Note',
      metaParts: [
        row.created_by ? (memberName.get(row.created_by) ?? null) : null,
        row.is_private ? 'private' : null,
        row.is_pinned ? 'pinned' : null,
      ].filter((p): p is string => Boolean(p)),
      body: row.body,
      icon: 'note',
      isPrivate: row.is_private,
    })
  }

  for (const row of tasks) {
    if (row.status !== 'done' || !row.completed_at) continue
    past.push({
      id: `task-${row.id}`,
      kind: 'task',
      category: 'other',
      at: row.completed_at,
      kindLabel: 'Task completed',
      metaParts: [
        row.action_type ? humanise(row.action_type).toLowerCase() : null,
        row.assigned_to ? (memberName.get(row.assigned_to) ?? null) : null,
      ].filter((p): p is string => Boolean(p)),
      body: row.title,
      icon: 'task',
    })
  }

  for (const row of installments) {
    if (row.status !== 'expected') continue
    upcoming.push({
      id: `installment-${row.id}`,
      label: `Pledge installment ${formatMoney(row.amount)}`,
      at: row.due_on,
      tone: new Date(row.due_on).getTime() < nowMs ? 'overdue' : 'neutral',
    })
  }

  past.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  upcoming.sort((a, b) => new Date(a.at ?? 0).getTime() - new Date(b.at ?? 0).getTime())

  return { past, upcoming }
}

export function filterTimeline(items: TimelineItem[], filter: 'all' | TimelineCategory): TimelineItem[] {
  if (filter === 'all') return items
  return items.filter((item) => item.category === filter)
}
