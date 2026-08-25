import { EmptyState } from '../components'
import { PageHeader } from '../features/shell/PageHeader'

/**
 * Reports `[P2]` — spec 10.
 *
 * TODO(reports): metric cards over saved filters (single number · progress
 * ring · live list), retention and LYBUNT/SYBUNT, appeal performance, export.
 */
export function ReportsRoute() {
  return (
    <>
      <PageHeader title="Reports" subtitle="Retention, appeals, giving trends · phase 2" />
      <EmptyState
        title="Reporting lands here"
        hint="Metric cards built from saved filters — donor retention against the sector benchmark, LYBUNT/SYBUNT movement, appeal and fund performance, and exports (an outward action, so it confirms)."
      />
    </>
  )
}
