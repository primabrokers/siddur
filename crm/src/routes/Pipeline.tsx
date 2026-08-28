import { Suspense, lazy } from 'react'

/**
 * Pipeline `[P2]` — moves management over `opportunities` (06 §2 · 02 §3.9).
 * The screen itself lives in `features/pipeline`; this is the route seam.
 *
 * Loaded on demand: the board is a whole feature (columns, drag, four dialogs)
 * that the daily loop never touches, and every other screen was paying for its
 * module graph at import time.
 */
const PipelineView = lazy(() =>
  import('../features/pipeline/PipelineView').then((module) => ({ default: module.PipelineView })),
)

export function PipelineRoute() {
  return (
    <Suspense fallback={<p className="py-10 text-center text-[13px] text-muted">Loading the board…</p>}>
      <PipelineView />
    </Suspense>
  )
}
