/**
 * Query keys for the WhatsApp channel (10 §2 Tier 2).
 *
 * Kept out of `keys.ts` for the same reason `giftaidKeys.ts` and
 * `importKeys.ts` are: these caches cross into other caches. Logging a thread
 * to the timeline writes an `interactions` row, so that mutation has to sweep
 * this file's prefixes **and** `qk.contacts.all` / `qk.interactions.all`;
 * linking a conversation to a donor changes what the contact profile shows.
 * Two factories at the call site make the pair explicit.
 */

export const wak = {
  wa: {
    /** Invalidation prefix for everything the pane reads. */
    all: ['whatsapp'] as const,
    /** The conversation list — one read, joined to contacts client-side. */
    conversations: () => ['whatsapp', 'conversations'] as const,
    /** One thread's messages, oldest first. */
    thread: (conversationId: string) => ['whatsapp', 'thread', conversationId] as const,
    /** The approved-template catalogue synced from Meta. */
    templates: () => ['whatsapp', 'templates'] as const,
    /** The Settings card's probe of the four secrets. */
    config: () => ['whatsapp', 'config'] as const,
  },
} as const
