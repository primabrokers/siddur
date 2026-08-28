/**
 * Query-key factory. One place so invalidation after a mutation stays exact
 * (optimistic write + 6s undo toast — I-12 / CLAUDE.md rule 4).
 *
 * Convention: `qk.<entity>.all` is the invalidation prefix; narrower keys nest
 * under it, so `invalidateQueries({ queryKey: qk.contacts.all })` sweeps the
 * lists, the detail records and the derived stats together.
 */

export type Filters = Record<string, unknown> | undefined

export const qk = {
  session: ['session'] as const,

  teamMember: {
    all: ['team-member'] as const,
    byUser: (userId: string | null | undefined) => ['team-member', userId ?? 'anon'] as const,
  },

  contacts: {
    all: ['contacts'] as const,
    list: (filters?: Filters) => ['contacts', 'list', filters ?? {}] as const,
    detail: (id: string) => ['contacts', 'detail', id] as const,
    /** The `contact_stats` view — the only source of derived numbers (I-8/I-9). */
    stats: (id: string) => ['contacts', 'stats', id] as const,
    timeline: (id: string) => ['contacts', 'timeline', id] as const,
    search: (term: string) => ['contacts', 'search', term] as const,
    /** Gifts + pledges + recurring agreements for the profile's Giving tab. */
    giving: (id: string) => ['contacts', 'giving', id] as const,
    notes: (id: string) => ['contacts', 'notes', id] as const,
    documents: (id: string) => ['contacts', 'documents', id] as const,
    tags: (id: string) => ['contacts', 'tags', id] as const,
    /** Gift Aid declarations on file for one contact. */
    declarations: (id: string) => ['contacts', 'declarations', id] as const,
    /** Create-time duplicate check (02 §6) — keyed by the normalised signals. */
    duplicates: (signals?: Filters) => ['contacts', 'duplicates', signals ?? {}] as const,
  },

  households: {
    all: ['households'] as const,
    detail: (id: string) => ['households', 'detail', id] as const,
    /** Members + their combined rollups (04 §5.5). */
    members: (id: string) => ['households', 'members', id] as const,
  },

  team: {
    all: ['team'] as const,
    list: () => ['team', 'list'] as const,
  },

  /** Tiny reference tables joined client-side (funds · campaigns · appeals). */
  refs: {
    all: ['refs'] as const,
    giving: () => ['refs', 'giving'] as const,
  },

  tasks: {
    all: ['tasks'] as const,
    list: (filters?: Filters) => ['tasks', 'list', filters ?? {}] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
    /**
     * The Action Stream *and* the Tasks view read this one board (open tasks +
     * today's completions + today's meetings + the contacts/stats they need),
     * so an optimistic complete/snooze has exactly one cache shape to patch.
     */
    stream: (filters?: Filters) => ['tasks', 'stream', filters ?? {}] as const,
    /** Queued (dateless) stack for one contact — the close-the-loop offer. */
    queued: (contactId: string) => ['tasks', 'queued', contactId] as const,
  },

  interactions: {
    all: ['interactions'] as const,
    list: (filters?: Filters) => ['interactions', 'list', filters ?? {}] as const,
    detail: (id: string) => ['interactions', 'detail', id] as const,
  },

  donations: {
    all: ['donations'] as const,
    list: (filters?: Filters) => ['donations', 'list', filters ?? {}] as const,
    detail: (id: string) => ['donations', 'detail', id] as const,
  },

  pledges: {
    all: ['pledges'] as const,
    list: (filters?: Filters) => ['pledges', 'list', filters ?? {}] as const,
    detail: (id: string) => ['pledges', 'detail', id] as const,
    installments: (pledgeId: string) => ['pledges', 'installments', pledgeId] as const,
  },

  giftAid: {
    all: ['gift-aid'] as const,
    claimable: (filters?: Filters) => ['gift-aid', 'claimable', filters ?? {}] as const,
    claims: () => ['gift-aid', 'claims'] as const,
  },

  opportunities: {
    all: ['opportunities'] as const,
    pipeline: (filters?: Filters) => ['opportunities', 'pipeline', filters ?? {}] as const,
    detail: (id: string) => ['opportunities', 'detail', id] as const,
  },

  /** The Action Stream rail. Storage is the `signals` table (02 §3.18). */
  nudges: {
    all: ['nudges'] as const,
    list: () => ['nudges', 'list'] as const,
    /** Overdue pledge installments — the rail's summary card (04 §1). */
    pledgeSummary: () => ['nudges', 'pledge-summary'] as const,
  },

  savedViews: {
    all: ['saved-views'] as const,
    list: () => ['saved-views', 'list'] as const,
    /** Sidebar PINNED VIEWS with their counts. */
    pinned: () => ['saved-views', 'pinned'] as const,
    detail: (id: string) => ['saved-views', 'detail', id] as const,
  },

  lookups: {
    all: ['lookups'] as const,
    list: (listName: string) => ['lookups', listName] as const,
  },

  reports: {
    all: ['reports'] as const,
    metric: (name: string, filters?: Filters) => ['reports', name, filters ?? {}] as const,
    /** The metric strip's money card: gifts received this calendar month. */
    monthGiving: (month: string) => ['reports', 'month-giving', month] as const,
  },
} as const

export type QueryKey = ReturnType<
  | typeof qk.contacts.list
  | typeof qk.contacts.detail
  | typeof qk.tasks.list
  | typeof qk.donations.list
>
