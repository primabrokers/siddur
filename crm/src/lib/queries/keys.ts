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
  },

  tasks: {
    all: ['tasks'] as const,
    list: (filters?: Filters) => ['tasks', 'list', filters ?? {}] as const,
    detail: (id: string) => ['tasks', 'detail', id] as const,
    /** The Action Stream for one day / owner. */
    stream: (filters?: Filters) => ['tasks', 'stream', filters ?? {}] as const,
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

  nudges: {
    all: ['nudges'] as const,
    list: () => ['nudges', 'list'] as const,
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
  },
} as const

export type QueryKey = ReturnType<
  | typeof qk.contacts.list
  | typeof qk.contacts.detail
  | typeof qk.tasks.list
  | typeof qk.donations.list
>
