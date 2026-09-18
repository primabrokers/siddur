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
  /**
   * Unknown fund names the user has agreed to create. A gift whose fund is
   * neither on file nor in this list has nowhere to be filed, so it is left
   * out of the plan — and the dry run says "4 gifts" only when four gifts are
   * genuinely going to be written.
   */
  createFunds?: string[]
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
export function buildCommitPlan({ rows, resolutions, funds, createFunds = [] }: PlanInput): CommitPlan {
  const creates: CommitPlan['creates'] = []
  const merges: CommitPlan['merges'] = []
  const gifts: CommitPlan['gifts'] = []
  const unknownFunds = new Set<string>()
  const agreed = new Set(createFunds.map((name) => name.trim().toLowerCase()))

  let blocked = 0
  let held = 0
  let skipped = 0
  let giftsWithoutFund = 0

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
      const name = row.gift.fund?.trim() ?? ''
      const onFile = Boolean(matchFund(funds, row.gift.fund))
      if (name !== '' && !onFile) unknownFunds.add(name)

      // A gift has to be filed under a fund (02 §3.4). One that has nowhere to
      // go is counted apart rather than promised and then quietly dropped.
      if (onFile || (name !== '' && agreed.has(name.toLowerCase()))) {
        gifts.push({ row, gift: row.gift, targetId, createIndex })
      } else {
        giftsWithoutFund += 1
      }
    }
  })

  const summary: DryRunSummary = {
    contacts: creates.length,
    merged: merges.length,
    held,
    skipped,
    gifts: gifts.length,
    giftsWithoutFund,
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
  /**
   * Rows this contact has gained **since the batch finished writing** — see
   * `IMPORT_SETTLE_MS`. Children created during the run itself are the
   * import's own echo, not somebody's work.
   */
  foreignChildren: number
}

/** A trigger-made row that has to be cleared before its contact can go. */
export interface UndoChild {
  id: string
  contact_id: string
}

export interface UndoPlan {
  batchId: string
  deleteContactIds: string[]
  deleteDonationIds: string[]
  /**
   * Automation rows the import itself provoked, on contacts that are being
   * removed. They must go first: `tasks.contact_id` and `signals.contact_id`
   * are `on delete no action`, so a contact still carrying its auto-generated
   * thank-you task cannot be deleted at all.
   */
  deleteTaskIds: string[]
  deleteSignalIds: string[]
  kept: Array<{ id: string; reason: string }>
}

/**
 * Timestamps within this many milliseconds count as "not touched since" —
 * `updated_at` is stamped by a trigger a few microseconds after `created_at`,
 * so exact equality would keep every row.
 */
export const UNTOUCHED_MS = 2000

/**
 * How long after a batch finishes writing its side effects still count as the
 * import's own.
 *
 * This exists because **the database answers an import back**. Inserting a
 * gift fires `donations_after_write` (08 §7), which creates an `auto:thank_you`
 * task against the brand-new contact and, for a first or major gift, a
 * `signals` row too. Those rows are indistinguishable by shape from a
 * fundraiser's own work — they are tasks on a contact — so a naive "has any
 * children?" test concludes that every imported donor has been worked on and
 * refuses to remove a single one. That is not a hypothetical: the first live
 * run of this wizard reported *"0 contacts and 1 gifts removed, 1 kept because
 * they have been used since"*.
 *
 * The honest discriminator is time, not shape: anything that appeared while
 * the batch was still running (or in the seconds after it, since the triggers
 * fire asynchronously to the client's own clock) belongs to the import. A
 * generous window is the safe direction to err in only because the *other*
 * guards still hold — the contact must still be batch-stamped, unmerged and
 * unedited — so a window that is slightly too wide cannot delete a record
 * somebody has actually touched.
 */
export const IMPORT_SETTLE_MS = 60_000

/**
 * The instant after which a child row counts as somebody's own work.
 *
 * `completed_at` is written by the commit when it finishes; a batch from before
 * that column existed falls back to `created_at`, which is the start of the run
 * rather than its end — so the settle window absorbs the difference either way.
 */
export function undoCutoff(batch: Pick<ImportBatchRow, 'created_at' | 'completed_at'>): number {
  const finished = Date.parse(batch.completed_at ?? '')
  const started = Date.parse(batch.created_at)
  const base = Number.isFinite(finished) ? finished : Number.isFinite(started) ? started : Date.now()
  return base + IMPORT_SETTLE_MS
}

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
 *
 * `automation` carries the trigger-made tasks and signals; the ones belonging
 * to contacts that survive the filter are returned for deletion, and the rest
 * are left exactly where they are.
 */
export function planBatchUndo(
  batchId: string,
  contacts: UndoCandidate[],
  donationIds: string[],
  automation: { tasks?: UndoChild[]; signals?: UndoChild[] } = {},
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

  const going = new Set(deleteContactIds)
  const owned = (rows: UndoChild[] | undefined): string[] =>
    (rows ?? []).filter((row) => going.has(row.contact_id)).map((row) => row.id)

  return {
    batchId,
    deleteContactIds,
    deleteDonationIds: [...donationIds],
    deleteTaskIds: owned(automation.tasks),
    deleteSignalIds: owned(automation.signals),
    kept,
  }
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
