/**
 * Query keys for the Reports screen (06 §3) and the campaign page (05 §4).
 *
 * Kept out of `keys.ts` on purpose — M8 owns these — but deliberately nested
 * under the same `['reports']` root so a blanket
 * `invalidateQueries({ queryKey: qk.reports.all })` still sweeps them.
 *
 * The scope (`this year` / `last year` / `all time`) is part of every key: the
 * header toggle switches the whole screen, and each period keeps its own cache
 * entry so flipping back is instant.
 */

/** `null` means all time — the `p_year` argument the RPCs take. */
export type ReportYear = number | null

const yearPart = (year: ReportYear): string => (year === null ? 'all' : String(year))

export const reportKeys = {
  all: ['reports'] as const,
  /** Everything M8 caches, for a targeted sweep that leaves the metric strip alone. */
  screen: ['reports', 'screen'] as const,
  /** One round trip for the whole gallery — `report_overview(p_year)`. */
  overview: (year: ReportYear) => ['reports', 'screen', 'overview', yearPart(year)] as const,
  /** The people behind one number — `report_drill(p_key, p_year, p_arg)`. */
  drill: (key: string, year: ReportYear, arg?: string | null) =>
    ['reports', 'screen', 'drill', key, yearPart(year), arg ?? ''] as const,
  /** One campaign page — `report_campaign_detail(p_campaign_id)`. */
  campaign: (id: string) => ['reports', 'screen', 'campaign', id] as const,
} as const
