import { CampaignPage } from '../features/reports/CampaignPage'
import { ReportsView } from '../features/reports/ReportsView'

/**
 * Reports — spec 06 §3 (artboard A8).
 *
 * Retention against sector benchmarks, giving over time, the six RFM personas,
 * campaign and appeal performance, fundraiser activity and Gift Aid. Every
 * number opens the list of people behind it.
 */
export function ReportsRoute() {
  return <ReportsView />
}

/** `/reports/campaigns/:id` — the per-campaign page (05 §4). */
export function CampaignDetailRoute() {
  return <CampaignPage />
}
