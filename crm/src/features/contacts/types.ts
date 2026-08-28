/**
 * Row shapes for the contact surfaces.
 *
 * Local interfaces on purpose (CLAUDE.md / `lib/database.types.ts`): the
 * generated Supabase types are a placeholder today, so every query annotates
 * its result with the shapes below. Field names come from spec 02 §3 — if the
 * generated types land and disagree, the spec wins and these move.
 */

import type { FlagVariant } from '../../components'

export type DonorStatus = 'prospect' | 'new' | 'active' | 'pre_lapsed' | 'lapsed'
export type EngagementTier = 'unknown' | 'cold' | 'cool' | 'warm' | 'hot' | 'on_fire'

/** 02 §3.1 — the fields the profile and the create/edit sheet touch. */
export interface ContactRow {
  id: string
  title: string | null
  first_name: string
  last_name: string | null
  hebrew_name: string | null
  organization: string | null
  position: string | null
  industry: string | null
  contact_kind: string | null
  is_organisation_self: boolean | null
  photo_url: string | null
  household_id: string | null

  email: string | null
  phone: string | null
  whatsapp: string | null
  preferred_language: string | null
  preferred_channel: string | null
  best_time_to_contact: string | null
  assistant_name: string | null
  assistant_contact: string | null
  linkedin_url: string | null
  website_url: string | null

  address_line1: string | null
  address_line2: string | null
  city: string | null
  postcode: string | null
  country: string | null

  source: string | null
  introduced_by_id: string | null
  introduced_by_note: string | null
  relationship_owner_id: string | null
  relationship_strength: number | null
  known_since: string | null
  mutual_connections: string | null
  birthday: string | null
  spouse_name: string | null
  family_notes: string | null
  things_to_remember: string | null

  stage: string
  priority: string
  tier: string | null
  estimated_capacity: number | null

  contact_frequency_days: number | null
  kit_paused_until: string | null

  engagement_score: number | null
  engagement_tier: EngagementTier | null
  pinned_note_id: string | null

  is_archived: boolean | null
  merged_into_id: string | null
}

/**
 * The `contact_stats` view (02 §4.1) — the only source of derived numbers
 * (I-8/I-9). Nothing here is ever recomputed in the client.
 */
export interface ContactStats {
  contact_id: string
  lifetime_giving: number | null
  this_year_giving: number | null
  last_year_giving: number | null
  /** Parallel soft-credit columns — never added to financial totals (D2). */
  soft_credit_lifetime: number | null
  soft_credit_this_year: number | null
  gift_count: number | null
  largest_gift: number | null
  average_gift: number | null
  first_gift_on: string | null
  first_gift_amount: number | null
  last_gift_on: string | null
  last_gift_amount: number | null
  is_lybunt: boolean
  is_sybunt: boolean
  pledge_balance: number | null
  last_contact_at: string | null
  last_contact_kind: string | null
  days_since_contact: number | null
  kit_due_on: string | null
  open_task_count: number | null
  next_action_id: string | null
  next_action_title: string | null
  next_action_due_on: string | null
  next_action_type: string | null
  flag: FlagVariant
  donor_status: DonorStatus | null
  /** 02 §4.2 magic column — present when the view exposes it. */
  has_ga_declaration: boolean | null
  /** Household rollups, computed in the view — never summed in the client (I-9). */
  household_id: string | null
  household_lifetime_giving: number | null
  household_gift_count: number | null
}

/** One contacts-list row: the record plus its derived numbers. */
export interface ContactListRow {
  contact: ContactRow
  stats: ContactStats | null
}

export interface HouseholdRow {
  id: string
  name: string | null
  formal_greeting: string | null
  informal_greeting: string | null
  hebrew_greeting: string | null
  greeting_is_override: boolean | null
  primary_contact_id: string | null
}

export interface TeamMemberLite {
  id: string
  full_name: string
}

export interface LookupOption {
  value: string
  label: string
  sort_order: number
  color: string | null
  meta: Record<string, unknown> | null
}

export interface InteractionRow {
  id: string
  contact_id: string
  occurred_at: string
  kind: string
  status: 'logged' | 'scheduled' | 'cancelled'
  team_member_id: string | null
  summary: string
  outcome: string | null
  is_meaningful: boolean | null
  location: string | null
  attendees: string | null
  purpose: string | null
  ask_amount: number | null
  source: string | null
}

export interface DonationRow {
  id: string
  contact_id: string
  donated_on: string
  /** Null when the row came from `donations_redacted` (11 §2). */
  amount: number | null
  currency: string
  amount_gbp: number | null
  fund_id: string | null
  campaign_id: string | null
  appeal_id: string | null
  payment_method: string | null
  status: string
  pledge_id: string | null
  installment_id: string | null
  recurring_agreement_id: string | null
  receipt_status: string
  /** Per-gift override of the receipt preference cascade (02 §3.4). */
  receipt_pref: string | null
  thank_you_status: string
  gift_aid_status: string
  gift_aid_claim_id: string | null
  is_gasds: boolean | null
  notes: string | null
}

export interface PledgeRow {
  id: string
  contact_id: string
  total_amount: number
  amount_gbp: number
  currency: string
  fund_id: string | null
  campaign_id: string | null
  appeal_id: string | null
  pledged_on: string
  status: string
  write_off_amount: number | null
  notes: string | null
}

export interface PledgeInstallmentRow {
  id: string
  pledge_id: string
  due_on: string
  amount: number
  status: string
}

export interface RecurringAgreementRow {
  id: string
  contact_id: string
  amount: number
  currency: string
  frequency: string
  payment_method: string | null
  fund_id: string | null
  starts_on: string
  ends_on: string | null
  /** Day of the month the payment is expected (02 §3.6). */
  expected_day: number | null
  status: string
  last_payment_on: string | null
  missed_count: number | null
}

export interface GiftAidDeclarationRow {
  id: string
  contact_id: string
  declared_on: string
  method: string
  covers_past: boolean | null
  covers_future: boolean | null
  covers_from: string | null
  cancelled_on: string | null
  evidence_url: string | null
}

export interface NoteRow {
  id: string
  contact_id: string
  category: string | null
  body: string
  is_private: boolean
  is_pinned: boolean
  created_by: string | null
  created_at: string
}

export interface DocumentRow {
  id: string
  contact_id: string
  title: string
  kind: string | null
  url: string | null
  storage_path: string | null
  created_at: string
}

export interface TaskRow {
  id: string
  contact_id: string
  title: string
  action_type: string | null
  details: string | null
  assigned_to: string | null
  due_on: string | null
  priority: string
  status: string
  waiting_for: string | null
  completed_at: string | null
  origin: string | null
}

export interface TagRow {
  id: string
  name: string
  category: string
  color: string | null
}

export interface TaggingRow {
  id: string
  tag_id: string
  contact_id: string
  is_excluded: boolean | null
  note: string | null
}

/** Named references joined client-side rather than through PostgREST embeds. */
export interface GivingRefs {
  funds: Record<string, string>
  campaigns: Record<string, string>
  appeals: Record<string, string>
}

/** Everything the Giving tab renders (05 §2–3). */
export interface ContactGiving {
  donations: DonationRow[]
  pledges: PledgeRow[]
  installments: PledgeInstallmentRow[]
  recurring: RecurringAgreementRow[]
  /** The gifts came through the redacted view: show the ledger, not the money. */
  amountsHidden: boolean
}

/** Draft shape for the create/edit sheet — a subset of 02 §3.1 (I-5). */
export interface ContactDraft {
  title: string
  first_name: string
  last_name: string
  hebrew_name: string
  organization: string
  position: string
  contact_kind: string
  email: string
  phone: string
  whatsapp: string
  preferred_language: string
  preferred_channel: string
  best_time_to_contact: string
  address_line1: string
  address_line2: string
  city: string
  postcode: string
  country: string
  spouse_name: string
  birthday: string
  things_to_remember: string
  introduced_by_note: string
  relationship_owner_id: string
  source: string
  stage: string
  priority: string
  tier: string
  contact_frequency_days: string
}
