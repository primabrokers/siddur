/**
 * Query keys for the Comms shell and its email channel (10 §3).
 *
 * Its own file, for the reason `journeyKeys.ts` and `importKeys.ts` are: the
 * email mutations reach outside their own prefix. Logging a message to the
 * timeline writes an `interactions` row, so it must sweep `qk.contacts.all`
 * (the profile's timeline and every derived number that hangs off it) as well
 * as `ck.emails.all`. Two factories side by side at the call site make that
 * pair something you have to write down rather than something you can forget.
 *
 * `ck.emails.all` is the invalidation prefix: sweeping it catches the folder
 * lists, the open thread and the rail's unread badge in one call, which is
 * what every folder move needs.
 */

import type { Filters } from './keys'

export const ck = {
  emails: {
    all: ['emails'] as const,
    /** One folder's rows, newest first. `filters` carries the ?contact= scope. */
    folder: (folder: string, filters?: Filters) => ['emails', 'folder', folder, filters ?? {}] as const,
    /** One conversation, oldest first — the reading pane. */
    thread: (threadKey: string | null) => ['emails', 'thread', threadKey ?? 'none'] as const,
    /** The rail badge: inbound, in the Inbox, never opened. */
    unread: () => ['emails', 'unread'] as const,
    /** Attachment metadata for the messages of one thread. */
    attachments: (emailIds: readonly string[]) => ['emails', 'attachments', [...emailIds].sort()] as const,
  },

  /**
   * The compose sheet's address book: every contact that has an email on file.
   * Cached hard (5 min) — it is a picker, not a report.
   */
  addressBook: {
    all: ['email-address-book'] as const,
    list: () => ['email-address-book', 'list'] as const,
  },

  /**
   * What the Settings card shows: whether the provider secrets are set. Probed
   * from the edge functions themselves, never from a table — the secrets are
   * never readable by the browser (the same rule the AI tab states).
   */
  setup: {
    all: ['email-setup'] as const,
    status: () => ['email-setup', 'status'] as const,
  },
} as const
