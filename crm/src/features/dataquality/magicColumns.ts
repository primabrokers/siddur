/**
 * Magic columns (03 §4, 06 §1) — any derived field from `contact_stats` added
 * to the contacts table as a read-only, sortable column.
 *
 * The invariant that shapes this file is I-8/I-9: **nothing here computes
 * anything.** Every column is a projection of a `contact_stats` field the view
 * already calculated; the client's whole job is to pick the field, format it,
 * and know how to sort it. A column that needed arithmetic would be a bug.
 *
 * Choices persist per view in localStorage, because "which columns do I want
 * on my LYBUNT list" is a personal working preference, not shared configuration
 * (I-6: settings live where the thing lives).
 *
 * (Filed under `dataquality/` with the merge tool and the bulk sheet: this is
 * the contacts-table tooling half of the milestone, and it keeps the edits to
 * `features/contacts/` down to the small surgical ones.)
 */

import type { ContactListRow, ContactStats } from '../contacts/types'
import { formatDayCount, formatMoney, formatNumber } from '../../lib/format'

export type MagicColumnId =
  | 'days_since_contact'
  | 'this_year_giving'
  | 'lifetime_giving'
  | 'last_year_giving'
  | 'pledge_balance'
  | 'engagement_tier'
  | 'donor_status'
  | 'gift_count'
  | 'largest_gift'
  | 'last_gift_on'
  | 'kit_due_on'
  | 'open_task_count'

export interface MagicColumn {
  id: MagicColumnId
  label: string
  /** Right-aligned, `tabular-nums` — money and counts. */
  numeric: boolean
  /** Rendered text. Empty string means "nothing to say", not zero. */
  render: (stats: ContactStats | null) => string
  /** Sort key; null sorts last whichever direction is asked for. */
  sortValue: (stats: ContactStats | null) => number | string | null
  /** Gold, `tabular-nums` — money follows the house rule (03 §2). */
  money?: boolean
}

const ENGAGEMENT_LABEL: Record<string, string> = {
  unknown: 'Unknown',
  cold: 'Cold',
  cool: 'Cool',
  warm: 'Warm',
  hot: 'Hot',
  on_fire: 'On fire',
}

const DONOR_STATUS_LABEL: Record<string, string> = {
  prospect: 'Prospect',
  new: 'New',
  active: 'Active',
  pre_lapsed: 'Pre-lapsed',
  lapsed: 'Lapsed',
}

const money = (value: number | null | undefined): string =>
  value === null || value === undefined || value === 0 ? '' : formatMoney(value)

export const MAGIC_COLUMNS: MagicColumn[] = [
  {
    id: 'days_since_contact',
    label: 'Days since contact',
    numeric: true,
    render: (s) => (s?.days_since_contact === null || s?.days_since_contact === undefined ? '' : formatDayCount(s.days_since_contact)),
    sortValue: (s) => s?.days_since_contact ?? null,
  },
  {
    id: 'this_year_giving',
    label: 'This year',
    numeric: true,
    money: true,
    render: (s) => money(s?.this_year_giving),
    sortValue: (s) => s?.this_year_giving ?? null,
  },
  {
    id: 'last_year_giving',
    label: 'Last year',
    numeric: true,
    money: true,
    render: (s) => money(s?.last_year_giving),
    sortValue: (s) => s?.last_year_giving ?? null,
  },
  {
    id: 'lifetime_giving',
    label: 'Lifetime',
    numeric: true,
    money: true,
    render: (s) => money(s?.lifetime_giving),
    sortValue: (s) => s?.lifetime_giving ?? null,
  },
  {
    id: 'pledge_balance',
    label: 'Pledge balance',
    numeric: true,
    money: true,
    render: (s) => money(s?.pledge_balance),
    sortValue: (s) => s?.pledge_balance ?? null,
  },
  {
    // The one column whose value lives on the contact record rather than the
    // stats view (02 §3.1 `engagement_tier`); `renderColumn` reads it there.
    id: 'engagement_tier',
    label: 'Engagement',
    numeric: false,
    render: () => '',
    sortValue: () => null,
  },
  {
    id: 'donor_status',
    label: 'Donor status',
    numeric: false,
    render: (s) => (s?.donor_status ? (DONOR_STATUS_LABEL[s.donor_status] ?? s.donor_status) : ''),
    sortValue: (s) => s?.donor_status ?? null,
  },
  {
    id: 'gift_count',
    label: 'Gifts',
    numeric: true,
    render: (s) => (s?.gift_count ? formatNumber(s.gift_count) : ''),
    sortValue: (s) => s?.gift_count ?? null,
  },
  {
    id: 'largest_gift',
    label: 'Largest gift',
    numeric: true,
    money: true,
    render: (s) => money(s?.largest_gift),
    sortValue: (s) => s?.largest_gift ?? null,
  },
  {
    id: 'last_gift_on',
    label: 'Last gift',
    numeric: false,
    render: (s) => s?.last_gift_on ?? '',
    sortValue: (s) => s?.last_gift_on ?? null,
  },
  {
    id: 'kit_due_on',
    label: 'Keep-in-touch due',
    numeric: false,
    render: (s) => s?.kit_due_on ?? '',
    sortValue: (s) => s?.kit_due_on ?? null,
  },
  {
    id: 'open_task_count',
    label: 'Open tasks',
    numeric: true,
    render: (s) => (s?.open_task_count ? formatNumber(s.open_task_count) : ''),
    sortValue: (s) => s?.open_task_count ?? null,
  },
]

export const MAGIC_COLUMN_BY_ID: Record<string, MagicColumn> = MAGIC_COLUMNS.reduce(
  (acc, column) => {
    acc[column.id] = column
    return acc
  },
  {} as Record<string, MagicColumn>,
)

/**
 * Engagement tier lives on the contact record, not the stats view, so its
 * column reads the row rather than the stats. Kept as a separate accessor so
 * `MAGIC_COLUMNS` can stay a pure `contact_stats` projection.
 */
export function renderColumn(column: MagicColumn, row: ContactListRow): string {
  if (column.id === 'engagement_tier') {
    const tier = row.contact.engagement_tier ?? 'unknown'
    return ENGAGEMENT_LABEL[tier] ?? String(tier)
  }
  return column.render(row.stats)
}

export function sortValueOf(column: MagicColumn, row: ContactListRow): number | string | null {
  if (column.id === 'engagement_tier') {
    const order = ['unknown', 'cold', 'cool', 'warm', 'hot', 'on_fire']
    const index = order.indexOf(row.contact.engagement_tier ?? 'unknown')
    return index <= 0 ? null : index
  }
  return column.sortValue(row.stats)
}

/**
 * Sort rows by a magic column. Nulls always sink — a contact with no gifts is
 * not "the smallest donor", it is a different question, and floating it to the
 * top of a descending sort would bury the answer being looked for.
 */
export function sortByColumn(
  rows: ContactListRow[],
  column: MagicColumn,
  direction: 'asc' | 'desc',
): ContactListRow[] {
  const factor = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = sortValueOf(column, a)
    const right = sortValueOf(column, b)
    if (left === null && right === null) return 0
    if (left === null) return 1
    if (right === null) return -1
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * factor
    return String(left).localeCompare(String(right)) * factor
  })
}

/* ------------------------------------------------------------ persistence */

export const COLUMNS_KEY = 'crm.contacts.magicColumns'

const memory = new Map<string, string>()

function readStore(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) return localStorage.getItem(key)
  } catch {
    /* private mode */
  }
  return memory.get(key) ?? null
}

function writeStore(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem(key, value)
      return
    }
  } catch {
    /* private mode / quota */
  }
  memory.set(key, value)
}

/** Per view, so the LYBUNT list and the full book can want different columns. */
export function loadColumns(viewKey: string): MagicColumnId[] {
  try {
    const raw = readStore(COLUMNS_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    const ids = (parsed as Record<string, unknown>)[viewKey]
    if (!Array.isArray(ids)) return []
    return ids.filter((id): id is MagicColumnId => typeof id === 'string' && id in MAGIC_COLUMN_BY_ID)
  } catch {
    return []
  }
}

export function saveColumns(viewKey: string, ids: MagicColumnId[]): void {
  let all: Record<string, unknown> = {}
  try {
    const raw = readStore(COLUMNS_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') all = parsed as Record<string, unknown>
    }
  } catch {
    all = {}
  }
  all[viewKey] = ids
  writeStore(COLUMNS_KEY, JSON.stringify(all))
}
