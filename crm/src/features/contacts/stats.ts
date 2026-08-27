/**
 * Reading the `contact_stats` view (02 §4.1).
 *
 * The view is owned by the migrations, not by this feature, so the client maps
 * it through one adapter rather than sprinkling raw column names across the UI.
 * Each field lists the column names it accepts; the canonical name is first.
 * If the view ever renames a column, this file is the only place to change.
 */

import type { FlagVariant } from '../../components'
import { FLAG_ORDER } from '../../components'
import type { ContactStats, DonorStatus, EngagementTier } from './types'

export type StatsRecord = Record<string, unknown>

function pick(row: StatsRecord, names: readonly string[]): unknown {
  for (const name of names) {
    const value = row[name]
    if (value !== undefined && value !== null) return value
  }
  return null
}

function num(row: StatsRecord, names: readonly string[]): number | null {
  const value = pick(row, names)
  if (value === null) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function str(row: StatsRecord, names: readonly string[]): string | null {
  const value = pick(row, names)
  if (value === null) return null
  const text = String(value).trim()
  return text === '' ? null : text
}

function bool(row: StatsRecord, names: readonly string[]): boolean | null {
  const value = pick(row, names)
  if (value === null) return null
  if (typeof value === 'boolean') return value
  const text = String(value).toLowerCase()
  return text === 'true' || text === 't' || text === '1'
}

const FLAG_ALIASES: Record<string, FlagVariant> = {
  overdue: 'overdue',
  red: 'overdue',
  today: 'today',
  orange: 'today',
  due_today: 'today',
  none: 'none',
  yellow: 'none',
  no_action: 'none',
  no_next_action: 'none',
  waiting: 'waiting',
  blue: 'waiting',
  future: 'future',
  grey: 'future',
  gray: 'future',
  scheduled: 'future',
  queued: 'queued',
  'queued-only': 'queued',
  queued_only: 'queued',
  dashed: 'queued',
}

export function toFlag(value: unknown): FlagVariant {
  if (typeof value !== 'string') return 'none'
  return FLAG_ALIASES[value.trim().toLowerCase()] ?? 'none'
}

const DONOR_STATUSES: DonorStatus[] = ['prospect', 'new', 'active', 'pre_lapsed', 'lapsed']

export function toDonorStatus(value: unknown): DonorStatus | null {
  if (typeof value !== 'string') return null
  const key = value.trim().toLowerCase().replace(/[\s-]/g, '_')
  return (DONOR_STATUSES as string[]).includes(key) ? (key as DonorStatus) : null
}

const ENGAGEMENT_TIERS: EngagementTier[] = ['unknown', 'cold', 'cool', 'warm', 'hot', 'on_fire']

export function toEngagementTier(value: unknown): EngagementTier {
  if (typeof value !== 'string') return 'unknown'
  const key = value.trim().toLowerCase().replace(/[\s-]/g, '_')
  return (ENGAGEMENT_TIERS as string[]).includes(key) ? (key as EngagementTier) : 'unknown'
}

/** Map one `contact_stats` row onto the shape the UI reads. */
export function mapContactStats(row: StatsRecord | null | undefined): ContactStats | null {
  if (!row) return null
  const contactId = str(row, ['contact_id', 'id'])
  if (!contactId) return null

  return {
    contact_id: contactId,
    lifetime_giving: num(row, ['lifetime_giving', 'lifetime_amount', 'lifetime_total', 'lifetime', 'total_giving']),
    this_year_giving: num(row, [
      'this_year_giving',
      'ytd_giving',
      'giving_this_year',
      'this_year_amount',
      'this_year',
    ]),
    last_year_giving: num(row, ['last_year_giving', 'giving_last_year', 'last_year_amount', 'last_year']),
    soft_credit_lifetime: num(row, [
      'soft_credit_lifetime',
      'soft_lifetime_giving',
      'soft_lifetime',
      'lifetime_soft_credit',
    ]),
    soft_credit_this_year: num(row, [
      'soft_credit_this_year',
      'soft_this_year_giving',
      'soft_this_year',
      'this_year_soft_credit',
    ]),
    gift_count: num(row, ['gift_count', 'gifts_count', 'donation_count']),
    largest_gift: num(row, ['largest_gift', 'largest_gift_amount', 'max_gift']),
    average_gift: num(row, ['average_gift', 'average_gift_amount', 'avg_gift']),
    first_gift_on: str(row, ['first_gift_on', 'first_gift_date', 'first_gift_at']),
    first_gift_amount: num(row, ['first_gift_amount', 'first_gift']),
    last_gift_on: str(row, ['last_gift_on', 'last_gift_date', 'last_gift_at']),
    last_gift_amount: num(row, ['last_gift_amount', 'last_gift']),
    is_lybunt: bool(row, ['is_lybunt', 'lybunt']) ?? false,
    is_sybunt: bool(row, ['is_sybunt', 'sybunt']) ?? false,
    pledge_balance: num(row, ['pledge_balance', 'pledge_balance_outstanding', 'outstanding_pledge_balance']),
    last_contact_at: str(row, [
      'last_meaningful_contact_at',
      'last_contact_at',
      'last_contact_on',
      'last_interaction_at',
    ]),
    last_contact_kind: str(row, ['last_meaningful_contact_kind', 'last_contact_kind', 'last_interaction_kind']),
    days_since_contact: num(row, ['days_since_contact', 'days_since_last_contact']),
    kit_due_on: str(row, ['kit_due_on', 'kit_due', 'keep_in_touch_due_on']),
    open_task_count: num(row, ['open_task_count', 'open_tasks', 'open_tasks_count']),
    next_action_id: str(row, ['next_action_id', 'next_task_id']),
    next_action_title: str(row, ['next_action_title', 'next_action', 'next_task_title']),
    next_action_due_on: str(row, ['next_action_due_on', 'next_action_due', 'next_task_due_on']),
    next_action_type: str(row, ['next_action_type', 'next_action_action_type', 'next_task_action_type']),
    flag: toFlag(pick(row, ['flag', 'flag_variant', 'flag_colour', 'flag_color'])),
    donor_status: toDonorStatus(pick(row, ['donor_status', 'status'])),
    has_ga_declaration: bool(row, [
      'has_ga_declaration',
      'has_gift_aid_declaration',
      'gift_aid_declaration_on_file',
      'ga_declaration',
    ]),
  }
}

/** Flag severity then name (I-3: yellow ranks worse than grey). */
export function compareByFlagThenName(
  a: { stats: ContactStats | null; name: string },
  b: { stats: ContactStats | null; name: string },
): number {
  const order = FLAG_ORDER[a.stats?.flag ?? 'none'] - FLAG_ORDER[b.stats?.flag ?? 'none']
  if (order !== 0) return order
  return a.name.localeCompare(b.name, 'en-GB')
}

export const DONOR_STATUS_LABEL: Record<DonorStatus, string> = {
  prospect: 'Prospect',
  new: 'New donor',
  active: 'Active donor',
  pre_lapsed: 'Pre-lapsed',
  lapsed: 'Lapsed',
}

export const ENGAGEMENT_LABEL: Record<EngagementTier, string> = {
  unknown: 'Not enough history yet',
  cold: 'Cold',
  cool: 'Cool',
  warm: 'Warm',
  hot: 'Hot',
  on_fire: 'On fire',
}

/** Five segments Cold→On Fire (04 §5.1); `unknown` fills none. */
export const ENGAGEMENT_SEGMENTS: Record<EngagementTier, number> = {
  unknown: 0,
  cold: 1,
  cool: 2,
  warm: 3,
  hot: 4,
  on_fire: 5,
}

/** KIT presets (04 §5.6) — the chips write `contact_frequency_days`. */
export const CADENCE_PRESETS: Array<{ label: string; days: number | null }> = [
  { label: '2w', days: 14 },
  { label: 'Monthly', days: 30 },
  { label: '2 months', days: 60 },
  { label: 'Quarterly', days: 90 },
  { label: '6m', days: 180 },
  { label: 'Annual', days: 365 },
  { label: 'None', days: null },
]

/** `en` → `English`. Falls back to the stored code for anything unlisted. */
export function languageLabel(code: string | null | undefined): string | null {
  if (!code) return null
  const known: Record<string, string> = {
    en: 'English',
    he: 'Hebrew',
    yi: 'Yiddish',
    fr: 'French',
    es: 'Spanish',
  }
  return known[code.toLowerCase()] ?? code
}

/** "every 2 months" / "Monthly" / "None" — the header's KIT chip. */
export function cadenceLabel(days: number | null | undefined): string {
  if (days === null || days === undefined) return 'None'
  if (days <= 14) return `every ${days} days`
  if (days <= 31) return 'Monthly'
  if (days <= 62) return 'every 2 months'
  if (days <= 95) return 'Quarterly'
  if (days <= 190) return 'every 6 months'
  if (days <= 400) return 'Annual'
  return `every ${days} days`
}
