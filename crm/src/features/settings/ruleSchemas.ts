/**
 * The automation-rule configuration surface (06 §4, 08 §7).
 *
 * 08 §7 is explicit about the shape: "the UI is generated from a static
 * per-rule schema, so adding a rule is a code change, tuning one never is".
 * This file *is* that static schema — one entry per `rule_key` in 08 §2–§3,
 * each with the plain-English description the settings table renders beside
 * its switch, and a typed field list for the parameters in
 * `automation_rules.params`.
 *
 * A rule_key with no entry here is not an error: the settings table falls back
 * to a read-only JSON view of its params, so a rule added by a migration is
 * visible and toggleable the moment it exists, tunable once someone writes its
 * three lines below.
 */

export type RuleFieldType = 'number' | 'text' | 'boolean' | 'money'

export interface RuleField {
  key: string
  label: string
  type: RuleFieldType
  /** Rendered after the input — "days", "£". */
  suffix?: string
  help?: string
}

export type RuleKind = 'trigger' | 'nightly'

export interface RuleSchema {
  label: string
  kind: RuleKind
  /** One sentence, in the fundraiser's language, not the engineer's. */
  description: string
  fields: RuleField[]
  /** `[P2]` in the spec — shown, but marked as not yet doing anything. */
  phase2?: boolean
}

const days = (key: string, label: string, help?: string): RuleField => ({
  key,
  label,
  type: 'number',
  suffix: 'days',
  ...(help ? { help } : {}),
})

/** 08 §2 (triggers, instant) and 08 §3 (nightly rules). */
export const RULE_SCHEMAS: Record<string, RuleSchema> = {
  /* ------------------------------------------------- 08 §2 trigger library */
  thank_you_on_gift: {
    label: 'Thank-you task on every gift',
    kind: 'trigger',
    description:
      'When a gift is saved, create a thank-you task. Gifts at or above the big-gift amount go to the relationship owner; at or above the major-gift amount a same-day nudge is raised too.',
    fields: [
      days('due_in_days', 'Due in'),
      { key: 'big_gift_threshold', label: 'Big gift', type: 'money', suffix: '£' },
      { key: 'major_gift_threshold', label: 'Major gift', type: 'money', suffix: '£' },
      {
        key: 'skip_if_open',
        label: 'Skip when a thank-you is already open',
        type: 'boolean',
        help: 'Stops a second task appearing when someone gives twice in a week.',
      },
    ],
  },
  receipt_on_gift: {
    label: 'Queue a receipt on every gift',
    kind: 'trigger',
    description:
      'When a gift is saved, queue its receipt using the preference cascade — the gift’s own preference, then the donor’s, then the system default below.',
    fields: [{ key: 'system_default', label: 'System default', type: 'text', help: 'email · letter · none' }],
  },
  first_gift_call: {
    label: 'Call after a first-ever gift',
    kind: 'trigger',
    description:
      'A donor’s first gift raises a nudge and a call task — the single strongest retention move there is.',
    fields: [{ key: 'within_hours', label: 'Call within', type: 'number', suffix: 'hours' }],
  },
  gift_aid_evaluate: {
    label: 'Work out Gift Aid on every gift',
    kind: 'trigger',
    description:
      'Recompute a gift’s Gift Aid status whenever the gift or a declaration changes, and attach eligible gifts to the rolling claim.',
    fields: [
      { key: 'back_years', label: 'Claim back', type: 'number', suffix: 'years' },
      { key: 'require_oral_confirmation', label: 'Require written confirmation of an oral declaration', type: 'boolean' },
    ],
  },
  ga_declaration_chase: {
    label: 'Chase a missing Gift Aid declaration',
    kind: 'trigger',
    description:
      'An eligible gift with no declaration on file queues a declaration request for a human to send. Nothing is sent automatically (I-10).',
    fields: [{ key: 'min_amount', label: 'Only for gifts over', type: 'money', suffix: '£' }],
  },
  household_soft_credit: {
    label: 'Soft-credit the household',
    kind: 'trigger',
    description:
      'A gift is soft-credited to the other members of the household. Soft credits are never added to financial totals.',
    fields: [],
  },
  influencer_prompt: {
    label: 'Offer influencer credit',
    kind: 'trigger',
    description:
      'When someone who was introduced by another contact gives, offer the one-tap credit chip on the gift screen. A prompt only — it writes nothing on its own.',
    fields: [],
  },
  tribute_acknowledgee: {
    label: 'Letter to the person being told about a tribute',
    kind: 'trigger',
    description:
      'A tribute gift with someone to notify raises a task to write to them (never the amount, only the gesture).',
    fields: [days('due_in_days', 'Due in')],
  },
  stage_change_prompts: {
    label: 'Prompt for the next move on a stage change',
    kind: 'trigger',
    description:
      'Moving to “proposal sent” starts the follow-up timer; advancing an opportunity asks for the next move when none is open (I-4).',
    fields: [],
  },
  pledge_schedule: {
    label: 'Generate pledge installments',
    kind: 'trigger',
    description:
      'Saving a pledge creates its installment schedule; applying a payment recomputes the balance.',
    fields: [],
  },

  /* --------------------------------------------------- 08 §3 nightly rules */
  kit_due: {
    label: 'Keep-in-touch tasks',
    kind: 'nightly',
    description:
      'When a contact’s keep-in-touch date passes and no keep-in-touch task is open, create one. The cadence is set per contact on the profile.',
    fields: [],
  },
  proposal_follow_up: {
    label: 'Follow up a sent proposal',
    kind: 'nightly',
    description:
      'A contact left at “proposal sent” with no interaction since and no open follow-up gets one.',
    fields: [days('days', 'Follow up after')],
  },
  pledge_chase: {
    label: 'Chase an overdue pledge installment',
    kind: 'nightly',
    description:
      'A missed installment raises a chase task — first gently, then again, then on a repeating cycle.',
    fields: [
      days('first_after_days', 'First chase after'),
      days('second_after_days', 'Second chase after'),
      days('repeat_days', 'Then every'),
    ],
  },
  recurring_failing: {
    label: 'Standing order stopped',
    kind: 'nightly',
    description:
      'A recurring payment that has not arrived marks the agreement as failing and raises a nudge: call, don’t email.',
    fields: [days('late_days', 'Treat as late after')],
  },
  neglect_flags: {
    label: 'Neglected-relationship nudges',
    kind: 'nightly',
    description:
      'Raise a nudge when there has been no meaningful contact for longer than the gap allowed for that kind of person.',
    fields: [
      days('high_priority_days', 'High priority'),
      days('active_donor_days', 'Active donor'),
      days('vip_days', 'VIP'),
      { key: 'vip_tag', label: 'VIP tag', type: 'text' },
    ],
  },
  engagement_recompute: {
    label: 'Recompute engagement scores',
    kind: 'nightly',
    description:
      'Rebuild every engagement score from the interaction and giving history, and nudge the relationship owner when someone’s tier drops.',
    fields: [
      days('lookback_days', 'Look back over'),
      days('halflife_days', 'Half-life'),
      days('recency_days', 'Recency bonus window'),
    ],
  },
  donor_status: {
    label: 'Donor status thresholds',
    kind: 'nightly',
    description:
      'How long since the last gift before someone counts as new, active, or heading for lapsed.',
    fields: [
      { key: 'new_months', label: 'New for', type: 'number', suffix: 'months' },
      { key: 'active_months', label: 'Active within', type: 'number', suffix: 'months' },
      { key: 'pre_lapsed_months', label: 'Pre-lapsed after', type: 'number', suffix: 'months' },
    ],
  },
  donor_status_recompute: {
    label: 'Recompute donor statuses',
    kind: 'nightly',
    description:
      'Apply the thresholds above every night, and raise a nudge for anyone who has just become pre-lapsed.',
    fields: [],
  },
  meeting_reminder: {
    label: 'Remind me about tomorrow’s meetings',
    kind: 'nightly',
    description: 'A scheduled meeting raises a reminder task the day before.',
    fields: [days('days_before', 'Remind')],
  },
  stale_prospects: {
    label: 'Stale prospects list',
    kind: 'nightly',
    description:
      'Opportunities that have not moved forward for this long appear on the pipeline’s “advance or decide” panel. No tasks — a visible list, not a nag.',
    fields: [days('days', 'Stale after')],
    phase2: true,
  },
  auto_tags: {
    label: 'Reapply automatic tags',
    kind: 'nightly',
    description: 'Re-evaluate every tag that is defined by saved-view criteria (LYBUNT, and the like).',
    fields: [],
  },
  rfm_recompute: {
    label: 'RFM personas',
    kind: 'nightly',
    description:
      'Recompute recency/frequency/value quintiles and the persona tags they feed (Champions, At-Risk, …).',
    fields: [],
    phase2: true,
  },
  no_next_action_audit: {
    label: 'Find contacts with no next action',
    kind: 'nightly',
    description:
      'Count active contacts with no open task and no keep-in-touch cadence — the yellow flag on Today. Surfaced, never fixed automatically (I-3).',
    fields: [],
  },
  duplicate_scan: {
    label: 'Scan for duplicates',
    kind: 'nightly',
    description:
      'Look for new pairs of records that might be the same person, and put them in the duplicates queue for review.',
    fields: [
      {
        key: 'name_similarity',
        label: 'Name similarity',
        type: 'number',
        help: '0–1; 0.6 is the spec default.',
      },
    ],
  },
}

/** Triggers first, then the nightly run — the order 08 presents them in. */
export const RULE_KIND_LABEL: Record<RuleKind, string> = {
  trigger: 'As it happens',
  nightly: 'Overnight',
}

export const ruleSchema = (key: string): RuleSchema | undefined => RULE_SCHEMAS[key]

/** Keys the settings screen renders elsewhere (Organisation / AI tabs). */
export const NON_RULE_KEYS = new Set(['org_details', 'ai_features'])

/** 09 §1 — the AI features that can be switched off independently. */
export interface AiFeature {
  key: string
  label: string
  description: string
}

export const AI_FEATURES: AiFeature[] = [
  {
    key: 'quick_capture_parse',
    label: 'Quick Capture extraction',
    description:
      'Turn a dictated sentence into a draft interaction, contact match, dates and a next action. The manual form always works without it.',
  },
  {
    key: 'daily_brief',
    label: 'Where we’re holding',
    description: 'A short written brief on a donor before you call them.',
  },
  {
    key: 'drafting',
    label: 'Message drafting',
    description: 'First drafts of WhatsApps, emails and letters, in your own tone samples.',
  },
  {
    key: 'digest_narrative',
    label: 'Digest narrative',
    description: 'One paragraph at the top of the morning digest, summarising the day.',
  },
]
