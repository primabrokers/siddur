/**
 * Typed data access for Reports (06 §3) and the campaign page (05 §4).
 *
 * Rules this file keeps:
 * - **Numbers come from SQL** (I-8). Three read-only RPCs do all the grouping;
 *   nothing here sums a row list. `report_overview` is one round trip for the
 *   whole gallery, `report_drill` is the list behind any number, and
 *   `report_campaign_detail` is the per-campaign page.
 * - **Redaction is the database's answer, not ours** (11 §2 / CLAUDE.md rule 7).
 *   The RPCs are `security definer` and check `crm_can_see_amounts()`
 *   themselves: a restricted viewer gets the same shape with every money key
 *   nulled and `amounts_hidden` true, so the cards fall back to counts instead
 *   of collapsing to zero (which is what reading `donations` through RLS would
 *   have produced).
 * - Read-only. There are no mutations on this screen, so no optimistic paths
 *   and no undo toast.
 */

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { reportKeys, type ReportYear } from './reportsKeys'
import type {
  CampaignDetail,
  DrillKey,
  DrillRow,
  ReportOverview,
} from '../../features/reports/types'

interface Failed {
  message: string
}

/**
 * One RPC call. `Database` is still `any` (see `lib/database.types.ts`), so the
 * return type is asserted here and the shape is owned by `features/reports/types`.
 */
async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error((error as unknown as Failed).message ?? `${fn} failed`)
  return data as unknown as T
}

/** Reports are expensive aggregates over the whole ledger — keep them warm. */
const STALE_MS = 60_000

/**
 * The whole Reports screen. The year toggle re-keys this query, so flipping
 * between This year / Last year / All time is a cache hit after the first look.
 */
export function useReportOverview(year: ReportYear): UseQueryResult<ReportOverview> {
  return useQuery<ReportOverview>({
    queryKey: reportKeys.overview(year),
    enabled: isConfigured,
    staleTime: STALE_MS,
    queryFn: () => callRpc<ReportOverview>('report_overview', { p_year: year }),
  })
}

/**
 * "…and here are the people" (06 §3). Only fetched once a number is clicked —
 * the sheet mounts disabled and turns on with its target.
 */
export function useReportDrill(
  key: DrillKey | null,
  year: ReportYear,
  arg?: string | null,
): UseQueryResult<DrillRow[]> {
  return useQuery<DrillRow[]>({
    queryKey: reportKeys.drill(key ?? 'none', year, arg),
    enabled: isConfigured && key !== null,
    staleTime: STALE_MS,
    queryFn: async () => {
      const rows = await callRpc<DrillRow[] | null>('report_drill', {
        p_key: key,
        p_year: year,
        p_arg: arg ?? null,
      })
      return rows ?? []
    },
  })
}

/** The per-campaign page (05 §4): progress vs goal, gifts, pledges, appeals. */
export function useCampaignDetail(campaignId: string | undefined): UseQueryResult<CampaignDetail> {
  return useQuery<CampaignDetail>({
    queryKey: reportKeys.campaign(campaignId ?? 'none'),
    enabled: isConfigured && Boolean(campaignId),
    staleTime: STALE_MS,
    queryFn: () => callRpc<CampaignDetail>('report_campaign_detail', { p_campaign_id: campaignId }),
  })
}
