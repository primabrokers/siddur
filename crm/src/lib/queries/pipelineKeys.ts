/**
 * Query keys owned by the Pipeline board (06 §2).
 *
 * Kept beside `keys.ts` rather than inside it — same reason as
 * `captureKeys.ts` and `importKeys.ts`: a milestone owns its own cache
 * namespace, so nothing it invalidates can collide with a screen built in
 * parallel. `qk.opportunities` in `keys.ts` stays the *shared* prefix other
 * surfaces (a donor profile's asks, the pipeline report) can sweep.
 *
 * Convention matches `qk`: `pk.pipeline.all` is the invalidation prefix and
 * every narrower key nests under it.
 */

export type PipelineFilters = Record<string, unknown> | undefined

export const pk = {
  pipeline: {
    all: ['pipeline'] as const,
    /**
     * Prefix for the board caches only. Optimistic drag patches target this,
     * so a refetch of the reference lists can never be patched by mistake.
     */
    boards: ['pipeline', 'board'] as const,
    board: (filters?: PipelineFilters) => ['pipeline', 'board', filters ?? {}] as const,
    detail: (id: string) => ['pipeline', 'detail', id] as const,
  },
} as const
