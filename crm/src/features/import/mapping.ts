/**
 * Column mapping (06 §5, step 2).
 *
 * The yeshiva's spreadsheet was not written for us: its headers say "Mobile",
 * "Gift Aid?" and "Amount (£)". Guessing well is the difference between a
 * five-minute import and an afternoon of dropdowns, so the guesser tries three
 * increasingly loose passes and stops at the first that fits — and every guess
 * stays overridable, because a wrong confident guess is worse than none.
 *
 * Templates are stored per-browser in localStorage keyed by *header text*, not
 * column position, so re-exporting the same sheet with a reordered column
 * still lands on the same mapping.
 */

import type { ColumnMapping, FieldSpec, ImportField, MappingTemplate } from './types'

/* ---------------------------------------------------------------- catalogue */

export const FIELD_SPECS: FieldSpec[] = [
  { field: 'title', label: 'Title', group: 'contact', synonyms: ['title', 'honorific', 'salutation', 'prefix'], hint: 'Rabbi / Mr / Mrs — canonicalised' },
  // A column headed simply "Name" is deliberately *not* a first-name synonym:
  // it is almost always a full name, and splitting it wrongly is worse than
  // asking. It stays unmapped until a human says what it is.
  { field: 'first_name', label: 'First name', group: 'contact', synonyms: ['firstname', 'first', 'forename', 'givenname', 'christianname'] },
  { field: 'last_name', label: 'Last name', group: 'contact', synonyms: ['lastname', 'last', 'surname', 'familyname', 'secondname'] },
  { field: 'hebrew_name', label: 'Hebrew name', group: 'contact', synonyms: ['hebrewname', 'hebrew', 'shemhakodesh', 'yiddishname'] },
  { field: 'organization', label: 'Organisation', group: 'contact', synonyms: ['organisation', 'organization', 'company', 'business', 'firm', 'employer'] },
  { field: 'position', label: 'Position', group: 'contact', synonyms: ['position', 'jobtitle', 'role', 'occupation'] },
  { field: 'email', label: 'Email', group: 'contact', synonyms: ['email', 'emailaddress', 'mail', 'eaddress'], hint: 'lowercased' },
  { field: 'phone', label: 'Phone', group: 'contact', synonyms: ['phone', 'telephone', 'tel', 'mobile', 'cell', 'phonenumber', 'homephone', 'landline'], hint: '→ E.164 (+44…)' },
  { field: 'whatsapp', label: 'WhatsApp', group: 'contact', synonyms: ['whatsapp', 'wa', 'whatsappnumber'], hint: '→ E.164 (+44…)' },
  { field: 'address_line1', label: 'Address line 1', group: 'contact', synonyms: ['address', 'address1', 'addressline1', 'street', 'streetaddress', 'house'] },
  { field: 'address_line2', label: 'Address line 2', group: 'contact', synonyms: ['address2', 'addressline2', 'street2'] },
  { field: 'city', label: 'City', group: 'contact', synonyms: ['city', 'town', 'locality', 'area'] },
  { field: 'postcode', label: 'Postcode', group: 'contact', synonyms: ['postcode', 'postalcode', 'zip', 'zipcode', 'post'] },
  { field: 'country', label: 'Country', group: 'contact', synonyms: ['country'] },
  { field: 'stage', label: 'Stage', group: 'contact', synonyms: ['stage', 'status', 'pipelinestage', 'donorstage'] },
  { field: 'priority', label: 'Priority', group: 'contact', synonyms: ['priority', 'importance'] },
  { field: 'tier', label: 'Tier', group: 'contact', synonyms: ['tier', 'band', 'category', 'level'] },
  { field: 'source', label: 'Source', group: 'contact', synonyms: ['source', 'howtheycame', 'origin', 'referredby', 'referral'] },
  { field: 'birthday', label: 'Birthday', group: 'contact', synonyms: ['birthday', 'birthdate', 'dob', 'dateofbirth'], hint: '→ ISO date' },
  { field: 'spouse_name', label: 'Spouse', group: 'contact', synonyms: ['spouse', 'spousename', 'wife', 'husband', 'partner'] },
  { field: 'things_to_remember', label: 'Things to remember', group: 'contact', synonyms: ['notes', 'note', 'comments', 'remarks', 'thingstoremember', 'background'] },

  { field: 'gift_amount', label: 'Gift amount', group: 'gift', synonyms: ['amount', 'giftamount', 'donation', 'donationamount', 'value', 'sum', 'gift'], hint: '£ and commas stripped' },
  { field: 'gift_date', label: 'Gift date', group: 'gift', synonyms: ['date', 'giftdate', 'donationdate', 'dategiven', 'paiddate', 'received'], hint: '→ ISO date' },
  { field: 'gift_fund', label: 'Fund', group: 'gift', synonyms: ['fund', 'designation', 'restricted', 'fundname'], hint: 'unknown names prompt creation' },
  { field: 'gift_campaign', label: 'Campaign', group: 'gift', synonyms: ['campaign', 'campaignname'] },
  { field: 'gift_appeal', label: 'Appeal', group: 'gift', synonyms: ['appeal', 'appealname', 'event'] },
  { field: 'gift_payment_method', label: 'Payment method', group: 'gift', synonyms: ['paymentmethod', 'method', 'paidby', 'payment', 'type'] },
  { field: 'gift_notes', label: 'Gift notes', group: 'gift', synonyms: ['giftnotes', 'donationnotes', 'reference', 'ref'] },
]

export const FIELD_LABEL: Record<ImportField, string> = FIELD_SPECS.reduce(
  (acc, spec) => {
    acc[spec.field] = spec.label
    return acc
  },
  {} as Record<ImportField, string>,
)

export const GIFT_FIELDS = FIELD_SPECS.filter((s) => s.group === 'gift').map((s) => s.field)

/* ------------------------------------------------------------------ guesser */

/** "Mobile Number " → "mobilenumber"; the comparison key for every pass. */
export function headerKey(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Longest synonym first, so "emailaddress" wins over "email" when a header
 * contains both — otherwise a substring pass matches the shorter one and the
 * more specific field never gets a look-in.
 */
const SYNONYM_INDEX: Array<{ key: string; field: ImportField }> = FIELD_SPECS.flatMap((spec) =>
  spec.synonyms.map((key) => ({ key, field: spec.field })),
).sort((a, b) => b.key.length - a.key.length)

/**
 * Guess one header's field, ignoring any already taken.
 *
 * Pass 1 — exact synonym.
 * Pass 2 — the header starts or ends with a synonym of ≥3 characters
 *          ("mobilephone" → phone), which keeps "wa" from claiming "warmth".
 * Pass 3 — the header contains one of ≥4 characters, so "tel" cannot match
 *          "clientele".
 *
 * The length floors are the whole reason this is three passes rather than one
 * `includes`: a two-letter synonym is only ever trustworthy as an exact match.
 */
export function guessField(header: string, taken: ReadonlySet<ImportField> = new Set()): ImportField | null {
  const key = headerKey(header)
  if (key === '') return null

  const free = SYNONYM_INDEX.filter((entry) => !taken.has(entry.field))
  const exact = free.find((entry) => entry.key === key)
  if (exact) return exact.field

  const prefixed = free.find(
    (entry) => entry.key.length >= 3 && (key.startsWith(entry.key) || key.endsWith(entry.key)),
  )
  if (prefixed) return prefixed.field

  const contained = free.find((entry) => entry.key.length >= 4 && key.includes(entry.key))
  return contained ? contained.field : null
}

/**
 * Guess the whole sheet. Each field is claimed at most once — a spreadsheet
 * with "Phone" and "Phone 2" should not write the same column twice; the
 * second falls through to WhatsApp or to "don't import", and the human sees it.
 */
export function guessMapping(headers: string[]): ColumnMapping {
  const taken = new Set<ImportField>()
  const mapping: ColumnMapping = []

  // Exact matches claim their field before any looser pass gets a look-in, so
  // a vague header cannot take the field its precise neighbour needs. Within
  // the exact pass, file order wins: two spellings of the same thing ("Phone",
  // "Telephone") are equally right, and the leftmost is the one a person reads
  // as the main column.
  headers.forEach((header, index) => {
    const key = headerKey(header)
    const exact = SYNONYM_INDEX.find((entry) => entry.key === key)
    mapping[index] = null
    if (exact && !taken.has(exact.field)) {
      mapping[index] = exact.field
      taken.add(exact.field)
    }
  })

  headers.forEach((header, index) => {
    if (mapping[index] !== null) return
    const guess = guessField(header, taken)
    if (guess) {
      mapping[index] = guess
      taken.add(guess)
    }
  })

  return mapping
}

/** True when the mapping can produce a contact at all (I-5's import echo). */
export function mappingIsUsable(mapping: ColumnMapping): boolean {
  return mapping.some((field) => field === 'first_name' || field === 'last_name' || field === 'organization')
}

/** True when any gift column is mapped — the file carries gifts as well. */
export function mappingHasGifts(mapping: ColumnMapping): boolean {
  return mapping.some((field) => field !== null && (GIFT_FIELDS as ImportField[]).includes(field))
}

/**
 * Gifts need an amount and a date to be a gift. Anything less is a contact
 * row with a stray column, which the wizard says out loud rather than
 * silently importing £0 gifts dated today.
 */
export function giftMappingProblems(mapping: ColumnMapping): string[] {
  if (!mappingHasGifts(mapping)) return []
  const problems: string[] = []
  if (!mapping.includes('gift_amount')) problems.push('Gift columns are mapped but no amount column is.')
  if (!mapping.includes('gift_date')) problems.push('Gift columns are mapped but no date column is.')
  return problems
}

/* ---------------------------------------------------------------- templates */

export const TEMPLATE_KEY = 'crm.import.mappingTemplates'

interface Store {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const memory = new Map<string, string>()

/** localStorage where it exists, an in-memory shim in jsdom/SSR. */
function store(): Store {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage
  } catch {
    /* Safari private mode throws on access — fall through. */
  }
  return {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => {
      memory.set(key, value)
    },
  }
}

export function loadTemplates(): MappingTemplate[] {
  try {
    const raw = store().getItem(TEMPLATE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (t): t is MappingTemplate =>
        Boolean(t) && typeof (t as MappingTemplate).id === 'string' && typeof (t as MappingTemplate).name === 'string',
    )
  } catch {
    return []
  }
}

export function saveTemplate(name: string, headers: string[], mapping: ColumnMapping): MappingTemplate[] {
  const byHeader: Record<string, ImportField> = {}
  headers.forEach((header, index) => {
    const field = mapping[index]
    if (field) byHeader[header] = field
  })

  const template: MappingTemplate = {
    id: `tpl-${Date.now().toString(36)}`,
    name: name.trim() || 'Untitled mapping',
    byHeader,
    savedAt: new Date().toISOString(),
  }

  // Same name replaces: saving "Yeshiva sheet" twice means correcting it once.
  const next = [template, ...loadTemplates().filter((t) => t.name !== template.name)].slice(0, 12)
  try {
    store().setItem(TEMPLATE_KEY, JSON.stringify(next))
  } catch {
    /* Quota or private mode: the template is simply not remembered. */
  }
  return next
}

export function deleteTemplate(id: string): MappingTemplate[] {
  const next = loadTemplates().filter((t) => t.id !== id)
  try {
    store().setItem(TEMPLATE_KEY, JSON.stringify(next))
  } catch {
    /* ignored — see saveTemplate */
  }
  return next
}

/**
 * Apply a template to this file's headers. Headers the template does not know
 * fall back to the guesser, so a sheet that grew a column still maps cleanly.
 */
export function applyTemplate(template: MappingTemplate, headers: string[]): ColumnMapping {
  const taken = new Set<ImportField>()
  const mapping: ColumnMapping = headers.map(() => null)

  const byKey = new Map<string, ImportField>()
  for (const [header, field] of Object.entries(template.byHeader)) byKey.set(headerKey(header), field)

  headers.forEach((header, index) => {
    const field = byKey.get(headerKey(header))
    if (field && !taken.has(field)) {
      mapping[index] = field
      taken.add(field)
    }
  })

  headers.forEach((header, index) => {
    if (mapping[index] !== null) return
    const guess = guessField(header, taken)
    if (guess) {
      mapping[index] = guess
      taken.add(guess)
    }
  })

  return mapping
}
