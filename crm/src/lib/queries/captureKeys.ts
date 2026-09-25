/**
 * Quick Capture's own query keys.
 *
 * Deliberately separate from `keys.ts`: capture is built alongside the Action
 * Stream and the task surfaces, and a shared key file is a guaranteed merge
 * collision. Same convention as `qk` — `.all` is the invalidation prefix.
 */

export const ck = {
  capture: {
    all: ['capture'] as const,
    /** The cached name roster used for client-side contact matching (09 §2). */
    contacts: () => ['capture', 'contacts'] as const,
    /** Tags, for the "add tag" suggestion chips. */
    tags: () => ['capture', 'tags'] as const,
  },
} as const
