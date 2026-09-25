/**
 * M9a's own query keys (briefs, drafts, digests).
 *
 * Deliberately separate from `keys.ts` and `captureKeys.ts` — same reason as
 * capture: milestones built in parallel must not fight over one file. Same
 * convention throughout: `.all` is the invalidation prefix.
 */

export const aik = {
  ai: {
    all: ['ai'] as const,

    /**
     * One cached brief per contact (09 §3). The *server* keys its cache by
     * viewer too; the browser only ever holds one user's session, so the
     * contact id is enough here.
     */
    briefs: ['ai', 'brief'] as const,
    brief: (contactId: string) => ['ai', 'brief', contactId] as const,

    /**
     * A draft is a mutation, not a query — it is generated on demand and never
     * refetched behind the user's back. This key exists so a sheet can hold the
     * last result across a re-render without a second call.
     */
    drafts: ['ai', 'draft'] as const,
    draft: (contactId: string, purpose: string, giftId?: string | null) =>
      ['ai', 'draft', contactId, purpose, giftId ?? 'no-gift'] as const,

    /**
     * "Has a person looked at this contact's AI content yet?" — read from
     * `ai_activity_log`, because 09 §1.4's boolean is derived, not stored.
     */
    reviews: ['ai', 'review'] as const,
    review: (contactId: string) => ['ai', 'review', contactId] as const,

    /** The morning digest preview (08 §6) shown in Settings. */
    digestPreview: () => ['ai', 'digest-preview'] as const,
  },
} as const
