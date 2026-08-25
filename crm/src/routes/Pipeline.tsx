import { EmptyState } from '../components'
import { PageHeader } from '../features/shell/PageHeader'

/**
 * Pipeline `[P2]` — moves management over `opportunities` (02 §3.9).
 *
 * TODO(pipeline): kanban by stage with flagged cards, days-in-stage, stale
 * detection from `last_moved_forward_at`, and drag between stages.
 */
export function PipelineRoute() {
  return (
    <>
      <PageHeader title="Pipeline" subtitle="Moves management · phase 2" />
      <EmptyState
        title="The opportunity pipeline lands here"
        hint="Asks as cards in stage columns, each carrying its flag, days in stage and projection — with stale prospects surfaced from last_moved_forward_at rather than enforced."
      />
    </>
  )
}
