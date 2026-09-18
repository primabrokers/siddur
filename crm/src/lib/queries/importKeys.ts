/**
 * Query keys for the import wizard and the data-quality surfaces.
 *
 * Kept apart from `keys.ts` on purpose: these are the only caches whose rows
 * are *about* other rows (a batch is a receipt for contacts and gifts; a
 * duplicate pair is a claim about two contacts). After a commit, an undo or a
 * merge, both this file's prefixes **and** `qk.contacts.all` have to be swept,
 * so the two factories being separate makes that pair of invalidations
 * explicit at every call site rather than accidental.
 */

export type Filters = Record<string, unknown> | undefined

export const ik = {
  /** CSV import (06 §5). */
  imports: {
    all: ['imports'] as const,
    /** Recent committed batches — the done screen and the history list. */
    batches: () => ['imports', 'batches'] as const,
    batch: (id: string) => ['imports', 'batch', id] as const,
    /** What a batch created, read back to decide what undo may delete. */
    batchRows: (id: string) => ['imports', 'batch-rows', id] as const,
    /** Funds for the gift mapping step, including inactive ones. */
    funds: () => ['imports', 'funds'] as const,
    /** The candidate pool the dedupe pass scores against. */
    candidates: (filters?: Filters) => ['imports', 'candidates', filters ?? {}] as const,
  },

  /** Merge tool + duplicates queue (06 §5). */
  dataquality: {
    all: ['data-quality'] as const,
    duplicates: (state: string) => ['data-quality', 'duplicates', state] as const,
    /** The two full contact records behind one queue row. */
    pair: (aId: string, bId: string) => ['data-quality', 'pair', aId, bId] as const,
    /** Child-row counts shown beside each side of the merge picker. */
    childCounts: (contactId: string) => ['data-quality', 'child-counts', contactId] as const,
  },
} as const
