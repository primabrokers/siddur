/**
 * Shapes the CSV import wizard passes between its steps (06 §5).
 *
 * The wizard is a pipeline of pure transforms — parse → map → normalise →
 * dedupe → plan → commit — and every stage's output is one of the types
 * below. Only the last stage touches the network, which is what makes the
 * first four unit-testable without a database.
 */

import type { ContactRow } from '../contacts/types'
import type { DuplicateReason } from '../contacts/normalise'

/* ------------------------------------------------------------------ fields */

/** Contact columns the wizard can fill. Superset of the create sheet (02 §3.1). */
export type ContactField =
  | 'title'
  | 'first_name'
  | 'last_name'
  | 'hebrew_name'
  | 'organization'
  | 'position'
  | 'email'
  | 'phone'
  | 'whatsapp'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'postcode'
  | 'country'
  | 'stage'
  | 'priority'
  | 'tier'
  | 'source'
  | 'birthday'
  | 'spouse_name'
  | 'things_to_remember'

/** Gift columns. All optional — a contacts-only CSV simply maps none of them. */
export type GiftField =
  | 'gift_amount'
  | 'gift_date'
  | 'gift_fund'
  | 'gift_campaign'
  | 'gift_appeal'
  | 'gift_payment_method'
  | 'gift_notes'

export type ImportField = ContactField | GiftField

export interface FieldSpec {
  field: ImportField
  label: string
  group: 'contact' | 'gift'
  /** Header spellings that map here, already normalised by `headerKey`. */
  synonyms: string[]
  /** Rendered under the picker: what the wizard will do with the value. */
  hint?: string
}

/** `columnIndex → field`; `null` means "don't import this column". */
export type ColumnMapping = Array<ImportField | null>

export interface MappingTemplate {
  id: string
  name: string
  /** Header text → field, so a template survives column re-ordering. */
  byHeader: Record<string, ImportField>
  savedAt: string
}

/* --------------------------------------------------------------- parse */

export interface ParsedCsv {
  filename: string
  headers: string[]
  rows: string[][]
  /** Papaparse's own complaints, already flattened to one line each. */
  problems: string[]
}

/* ----------------------------------------------------------- normalise */

export type IssueLevel = 'warn' | 'block'

export interface RowIssue {
  field: ImportField | 'row'
  level: IssueLevel
  message: string
}

/** One field the normaliser rewrote — the preview table's rows. */
export interface FieldChange {
  field: ImportField
  from: string
  to: string
  /** Why: "phone → E.164", "date → ISO", "title case". */
  rule: string
}

export interface GiftDraft {
  amount: number
  donated_on: string
  fund: string | null
  campaign: string | null
  appeal: string | null
  payment_method: string | null
  notes: string | null
}

export interface NormalisedRow {
  /** 1-based line number in the file, header excluded — what a human counts. */
  line: number
  /** Values ready to write, empty fields absent. */
  contact: Partial<Record<ContactField, string>>
  gift: GiftDraft | null
  changes: FieldChange[]
  issues: RowIssue[]
  /** Convenience for the preview and the dedupe pass. */
  displayName: string
}

/* -------------------------------------------------------------- dedupe */

export type DedupeAction = 'create' | 'skip' | 'merge' | 'review'

export interface ExistingMatch {
  contact: ContactRow
  reasons: DuplicateReason[]
  score: number
}

export interface RowDuplicate {
  /** Index into the normalised rows. */
  index: number
  /** Best match among records already in the database. */
  existing: ExistingMatch | null
  /** Index of the earlier row in *this file* this one duplicates. */
  withinFile: number | null
  reasons: DuplicateReason[]
}

export interface Resolution {
  action: DedupeAction
  /** Set when `action === 'merge'`: the existing contact to fill in. */
  targetId: string | null
  /** True while the user has not overridden the wizard's own default. */
  isDefault: boolean
}

export type ResolutionMap = Record<number, Resolution>

/* ---------------------------------------------------------- dry run */

export interface DryRunSummary {
  /** New contacts to insert. */
  contacts: number
  /** Existing contacts to fill in. */
  merged: number
  /** Duplicates parked for a human — not written this run. */
  held: number
  skipped: number
  /** Gifts to insert (rows with a gift whose contact survives). */
  gifts: number
  /** Gifts with no fund to file them under — not written, and said so. */
  giftsWithoutFund: number
  /** Rows with a blocking issue; never written. */
  blocked: number
  /** Fund names in the file with no matching fund record. */
  unknownFunds: string[]
}

export interface CommitPlan {
  summary: DryRunSummary
  /** Rows that become new contacts, in file order. */
  creates: NormalisedRow[]
  /** Rows that fill in an existing contact. */
  merges: Array<{ row: NormalisedRow; targetId: string }>
  /** Gifts, each already bound to whichever contact it will hang from. */
  gifts: Array<{ row: NormalisedRow; gift: GiftDraft; targetId: string | null; createIndex: number | null }>
}

/* ------------------------------------------------------------ batches */

export interface ImportBatchRow {
  id: string
  filename: string
  started_by: string | null
  created_at: string
  contact_count: number
  donation_count: number
  status: 'committed' | 'undone'
  undone_at: string | null
}

export interface FundRow {
  id: string
  name: string
  code: string | null
  is_active: boolean
}
