/**
 * Dry run and commit plan (06 §5, steps 5–6) — and the undo eligibility rule
 * that makes step 7 safe (11 §7).
 *
 * Everything here is pure. The wizard shows the summary this module computes,
 * and the query layer executes the plan this module builds; nothing decides
 * "what will happen" twice.
 */

import type {
  CommitPlan,
  DryRunSummary,
  FundRow,
  ImportBatchRow,
  NormalisedRow,
  ResolutionMap,
} from './types'
import { isBlocked } from './normalisePreview'

/* --------------------------------------------------------------- the plan */

export interface PlanInput {
  rows: NormalisedRow[]
  resolutions: ResolutionMap
  /** Funds already on file; matched case-insensitively by name or code. */
  funds: FundRow[]
}

const fundKey = (name: string): string => name.trim().toLowerCase()

export function matchFund(funds: FundRow[], name: string | null): FundRow | null {
  if (!name) return null
  const key = fundKey(name)
  return (
    funds.find((f) => fundKey(f.name) === key) ??
    funds.find((f) => f.code !== null && fundKey(f.code) === key) ??
    null
  )
}

/**
 * Turn rows + resolutions into the exact set of writes.
 *
 * The ordering rule that matters: a gift belongs to whichever contact its row
 * produces. For a `create` row that contact does not exist yet, so the gift
 * carries `createIndex` — the position in `creates` whose returned id it will
 * be given once the insert comes back.
 */
export function buildCommitPlan({ rows, resolutions, funds }: PlanInput): CommitPlan {
  const creates: CommitPlan['creates'] = []
  const merges: CommitPlan['merges'] = []
  const gifts: CommitPlan['gifts'] = []
  const unknownFunds = new Set<string>()

  let blocked = 0
  let held = 0
  let skipped = 0

  rows.forEach((row, index) => {
    if (isBlocked(row)) {
      blocked += 1
      return
    }

    const resolution = resolutions[index] ?? { action: 'create' as const, targetId: null, isDefault: true }

    if (resolution.action === 'review') {
      held += 1
      return
    }
    if (resolution.action === 'skip') {
      skipped += 1
      return
    }

    let targetId: string | null = null
    let createIndex: number | null = null

    if (resolution.action === 'merge' && resolution.targetId) {
      merges.push({ row, targetId: resolution.targetId })
      targetId = resolution.targetId
    } else {
      createIndex = creates.length
      creates.push(row)
    }

    if (row.gift) {
      if (row.gift.fund && !matchFund(funds, row.gift.fund)) unknownFunds.add(row.gift.fund.trim())
      gifts.push({ row, gift: row.gift, targetId, createIndex })
    }
  })

  const summary: DryRunSummary = {
    contacts: creates.length,
    merged: merges.length,
    held,
    skipped,
    gifts: gifts.length,
    blocked,
    unknownFunds: [...unknownFunds].sort((a, b) => a.localeCompare(b)),
  }

  return { summary, creates, merges, gifts }
}

/**
 * The one sentence the dry-run screen leads with — the spec's own example
 * shape: "142 contacts, 3 held for review, 890 gifts".
 */
export function summarySentence(summary: DryRunSummary): string {
  const parts: string[] = [`${summary.contacts} ${summary.contacts === 1 ? 'contact' : 'contacts'}`]
  if (summary.merged > 0) parts.push(`${summary.merged} filled in`)
  if (summary.held > 0) parts.push(`${summary.held} held for review`)
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped`)
  if (summary.gifts > 0) parts.push(`${summary.gifts} ${summary.gifts === 1 ? 'gift' : 'gifts'}`)
  if (summary.blocked > 0) parts.push(`${summary.blocked} unusable`)
  return parts.join(', ')
}

/**
 * The values a `merge` row writes onto the existing contact.
 *
 * **Fill blanks only.** An import is new information about a person, not a
 * replacement for what a fundraiser typed after speaking to them; overwriting
 * a hand-corrected phone number with a stale spreadsheet cell is the one way
 * an import can destroy work. Anything the file disagrees with is left for
 * the merge tool, where a human picks side by side.
 */
export function fillBlanksPatch(
  row: NormalisedRow,
  existing: Record<string, unknown>,
): Record<string, string> {
  const patch: Record<string, string> = {}
  for (const [field, value] of Object.entries(row.contact)) {
    if (!value) continue
    const current = existing[field]
    if (current === null || current === undefined || String(current).trim() === '') patch[field] = value
  }
  return patch
}

/* -------------------------------------------------------------- undo rule */

export interface UndoCandidate {
  id: string
  /** The batch that created it. */
  import_batch: string | null
  created_at: string
  updated_at: string
  merged_into_id: string | null
  /** Rows this contact has gained that the batch did not create. */
  foreignChildren: number
}

export interface UndoPlan {
  batchId: string
  deleteContactIds: string[]
  deleteDonationIds: string[]
  kept: Array<{ id: string; reason: string }>
}

/**
 * Timestamps within this many milliseconds count as "not touched since" —
 * `updated_at` is stamped by a trigger a few microseconds after `created_at`,
 * so exact equality would keep every row.
 */
export const UNTOUCHED_MS = 2000

/**
 * What a batch undo may delete.
 *
 * Undo is a *recovery* tool, not a rollback engine: it removes what the import
 * made **and nobody has since touched**. A contact somebody has edited, merged
 * away, or hung a conversation off has stopped being an import artefact and
 * become a record — the wizard keeps it and says why.
 *
 * Gifts the batch created are always removed; they are stamped with the batch,
 * they carry no independent history, and leaving them behind would double-count
 * the donor's lifetime giving on the re-import.
 */
export function planBatchUndo(
  batchId: string,
  contacts: UndoCandidate[],
  donationIds: string[],
): UndoPlan {
  const deleteContactIds: string[] = []
  const kept: UndoPlan['kept'] = []

  for (const contact of contacts) {
    if (contact.import_batch !== batchId) {
      kept.push({ id: contact.id, reason: 'not created by this import' })
      continue
    }
    if (contact.merged_into_id) {
      kept.push({ id: contact.id, reason: 'merged into another record since' })
      continue
    }
    if (contact.foreignChildren > 0) {
      kept.push({ id: contact.id, reason: 'has activity logged since the import' })
      continue
    }
    const created = Date.parse(contact.created_at)
    const updated = Date.parse(contact.updated_at)
    if (Number.isFinite(created) && Number.isFinite(updated) && updated - created > UNTOUCHED_MS) {
      kept.push({ id: contact.id, reason: 'edited since the import' })
      continue
    }
    deleteContactIds.push(contact.id)
  }

  return { batchId, deleteContactIds, deleteDonationIds: [...donationIds], kept }
}

/** The done screen's sentence for what undo will actually do. */
export function describeUndo(plan: UndoPlan): string {
  const parts = [
    `${plan.deleteContactIds.length} ${plan.deleteContactIds.length === 1 ? 'contact' : 'contacts'}`,
  ]
  if (plan.deleteDonationIds.length > 0) {
    parts.push(`${plan.deleteDonationIds.length} ${plan.deleteDonationIds.length === 1 ? 'gift' : 'gifts'}`)
  }
  const head = `Removes ${parts.join(' and ')}`
  return plan.kept.length === 0
    ? `${head}.`
    : `${head}; ${plan.kept.length} kept because they have been used since.`
}

/** Batches older than this are no longer offered a one-click undo. */
export const UNDO_WINDOW_DAYS = 30

export function undoAvailable(batch: ImportBatchRow, now: Date = new Date()): boolean {
  if (batch.status !== 'committed') return false
  const created = Date.parse(batch.created_at)
  if (!Number.isFinite(created)) return true
  return now.getTime() - created <= UNDO_WINDOW_DAYS * 24 * 60 * 60 * 1000
}
