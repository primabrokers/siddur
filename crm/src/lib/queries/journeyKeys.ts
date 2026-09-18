/**
 * Query keys for journeys (08 §4) and the calendar feed (10 §4).
 *
 * Kept apart from `keys.ts` for the same reason `importKeys.ts` is: attaching
 * or detaching a journey writes **tasks**, so every mutation here has to sweep
 * `qk.tasks.all` and `qk.contacts.all` as well as its own prefix. Two
 * factories side by side at the call site make that pair of invalidations
 * something you have to write down rather than something you can forget.
 */

export const jk = {
  journeys: {
    all: ['journeys'] as const,
    /** Active templates with their steps — the attach picker. */
    templates: () => ['journeys', 'templates'] as const,
    /** One contact's enrolments joined to their steps' tasks. */
    forContact: (contactId: string) => ['journeys', 'contact', contactId] as const,
  },

  /** The signed-in member's own ICS token (10 §4). Never another member's. */
  calendarFeed: {
    all: ['calendar-feed'] as const,
    token: (memberId: string | null | undefined) =>
      ['calendar-feed', 'token', memberId ?? 'me'] as const,
  },
} as const
