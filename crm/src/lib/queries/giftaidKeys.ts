/**
 * Query keys for the Gift Aid workspace (05 §5, 07 §8).
 *
 * Kept apart from `keys.ts` for the same reason `importKeys.ts` is: these
 * caches are *about* other caches. Filing a claim stamps donations, opens a new
 * claim and moves a donor out of the chase queue, so every mutation here has to
 * sweep this file's prefixes **and** `qk.giving.all` / `qk.donations.all` /
 * `qk.contacts.all`. Two factories make that pair explicit at each call site.
 *
 * `qk.giftAid` in `keys.ts` stays where it is — it belongs to the Giving
 * screen's read of claim state and is never invalidated from here alone.
 */

export type Filters = Record<string, unknown> | undefined

export const gak = {
  giftAid: {
    /** Invalidation prefix for everything the workspace reads. */
    all: ['gift-aid-workspace'] as const,
    /** The one board read behind the three panels (05 §5). */
    board: () => ['gift-aid-workspace', 'board'] as const,
    /** `ga_claim_validation(claim)` — one row per failure, empty means ready. */
    validation: (claimId: string) => ['gift-aid-workspace', 'validation', claimId] as const,
    /** The gifts on one claim, joined to their donors — the CSV's rows. */
    lines: (claimId: string) => ['gift-aid-workspace', 'lines', claimId] as const,
    /** The saved view the 4-year back-claim card links to (07 §10). */
    backClaimView: () => ['gift-aid-workspace', 'back-claim-view'] as const,
  },
} as const
