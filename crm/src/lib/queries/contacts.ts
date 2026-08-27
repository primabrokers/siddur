/**
 * Typed data access for contacts — the list, the donor profile and every
 * mutation those two surfaces make.
 *
 * Rules this file keeps:
 * - Derived numbers come from `contact_stats` only (I-8/I-9); nothing is
 *   recomputed here.
 * - No PostgREST embeds. Reference tables (funds, campaigns, appeals, team
 *   members) are tiny, so they are fetched once and joined client-side; that
 *   keeps the queries independent of FK constraint names.
 * - Mutations are optimistic; the 6-second undo toast lives at the call site
 *   for the reversible ones (I-12 / CLAUDE.md rule 4).
 */

import { useMemo } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult,
} from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import {
  mapContactStats,
  compareByFlagThenName,
  type StatsRecord,
} from '../../features/contacts/stats'
import {
  displayName,
  fullName,
  normaliseEmail,
  normalisePhone,
  nullable,
  rankDuplicates,
  scoreDuplicate,
  type DuplicateMatch,
  type DuplicateSignals,
} from '../../features/contacts/normalise'
import { buildTimeline, type TimelineFeed } from '../../features/contacts/timeline'
import type {
  ContactDraft,
  ContactGiving,
  ContactListRow,
  ContactRow,
  ContactStats,
  DocumentRow,
  DonationRow,
  GiftAidDeclarationRow,
  GivingRefs,
  HouseholdRow,
  InteractionRow,
  LookupOption,
  NoteRow,
  PledgeInstallmentRow,
  PledgeRow,
  RecurringAgreementRow,
  TagRow,
  TaggingRow,
  TaskRow,
  TeamMemberLite,
} from '../../features/contacts/types'

/* ------------------------------------------------------------------ helpers */

interface Failed {
  message: string
}

async function selectRows<T>(
  table: string,
  build: (q: any) => any,
): Promise<T[]> {
  const { data, error } = await build(supabase.from(table).select('*'))
  if (error) throw new Error((error as Failed).message)
  return ((data ?? []) as unknown) as T[]
}

async function selectMaybe<T>(table: string, build: (q: any) => any): Promise<T | null> {
  const { data, error } = await build(supabase.from(table).select('*'))
  if (error) throw new Error((error as Failed).message)
  return ((data ?? null) as unknown) as T | null
}

/** De-duplicate id lists before an `in` filter. */
const unique = <T,>(values: T[]): T[] => Array.from(new Set(values))

/* -------------------------------------------------------------- reference */

export function useTeamMembers(): UseQueryResult<TeamMemberLite[]> {
  return useQuery<TeamMemberLite[]>({
    queryKey: qk.team.list(),
    enabled: isConfigured,
    staleTime: 10 * 60_000,
    queryFn: () =>
      selectRows<TeamMemberLite>('team_members', (q) => q.order('full_name', { ascending: true })),
  })
}

export function useGivingRefs(): UseQueryResult<GivingRefs> {
  return useQuery<GivingRefs>({
    queryKey: qk.refs.giving(),
    enabled: isConfigured,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const [funds, campaigns, appeals] = await Promise.all([
        selectRows<{ id: string; name: string }>('funds', (q) => q),
        selectRows<{ id: string; name: string }>('campaigns', (q) => q),
        selectRows<{ id: string; name: string }>('appeals', (q) => q),
      ])
      const index = (rows: Array<{ id: string; name: string }>) =>
        Object.fromEntries(rows.map((r) => [r.id, r.name]))
      return { funds: index(funds), campaigns: index(campaigns), appeals: index(appeals) }
    },
  })
}

export function useLookupOptions(listName: string): UseQueryResult<LookupOption[]> {
  return useQuery<LookupOption[]>({
    queryKey: qk.lookups.list(listName),
    enabled: isConfigured && listName.length > 0,
    staleTime: 10 * 60_000,
    queryFn: () =>
      selectRows<LookupOption>('lookup_options', (q) =>
        q.eq('list_name', listName).eq('is_active', true).order('sort_order', { ascending: true }),
      ),
  })
}

/** `{ meeting: 'Meeting' }` — labels for the timeline's kind heads. */
export function useInteractionKindLabels(): Record<string, string> {
  const { data } = useLookupOptions('interaction_kind')
  // Stable identity: this feeds a useMemo dependency list in the timeline hook.
  return useMemo(() => Object.fromEntries((data ?? []).map((o) => [o.value, o.label])), [data])
}

/* ------------------------------------------------------------------- stats */

/**
 * `contact_stats` for a set of contacts. The view is created by the migrations;
 * until it exists the error is reported rather than swallowed, but it never
 * blocks the record itself from rendering.
 */
async function fetchStats(contactIds: string[]): Promise<{
  stats: Record<string, ContactStats>
  error: string | null
}> {
  const ids = unique(contactIds)
  if (ids.length === 0) return { stats: {}, error: null }

  const collect = (rows: StatsRecord[]) => {
    const stats: Record<string, ContactStats> = {}
    for (const row of rows) {
      const mapped = mapContactStats(row)
      if (mapped) stats[mapped.contact_id] = mapped
    }
    return stats
  }

  try {
    return { stats: collect(await selectRows('contact_stats', (q) => q.in('contact_id', ids))), error: null }
  } catch (caught) {
    // The view may key on `id` rather than `contact_id`; try once before
    // reporting, so a naming difference degrades to slower, not broken.
    try {
      return { stats: collect(await selectRows('contact_stats', (q) => q.in('id', ids))), error: null }
    } catch {
      return { stats: {}, error: caught instanceof Error ? caught.message : 'contact_stats unavailable' }
    }
  }
}

/* -------------------------------------------------------------------- list */

export interface ContactsListResult {
  rows: ContactListRow[]
  statsError: string | null
}

export interface ContactsListOptions {
  includeArchived?: boolean
}

export function useContactsList(options: ContactsListOptions = {}): UseQueryResult<ContactsListResult> {
  const { includeArchived = false } = options
  return useQuery<ContactsListResult>({
    queryKey: qk.contacts.list({ includeArchived }),
    enabled: isConfigured,
    queryFn: async () => {
      const contacts = await selectRows<ContactRow>('contacts', (q) => {
        let query = q.is('merged_into_id', null)
        if (!includeArchived) query = query.eq('is_archived', false)
        return query.order('last_name', { ascending: true }).order('first_name', { ascending: true })
      })
      const { stats, error } = await fetchStats(contacts.map((c) => c.id))
      const rows: ContactListRow[] = contacts.map((contact) => ({
        contact,
        stats: stats[contact.id] ?? null,
      }))
      rows.sort((a, b) =>
        compareByFlagThenName(
          { stats: a.stats, name: fullName(a.contact) },
          { stats: b.stats, name: fullName(b.contact) },
        ),
      )
      return { rows, statsError: error }
    },
  })
}

/* ------------------------------------------------------------------ detail */

export interface ContactDetail {
  contact: ContactRow
  stats: ContactStats | null
  statsError: string | null
  /** Resolved `introduced_by_id` (04 §5.1's third line). */
  introducedBy: { id: string; name: string } | null
}

export function useContact(id: string | undefined): UseQueryResult<ContactDetail> {
  return useQuery<ContactDetail>({
    queryKey: qk.contacts.detail(id ?? 'none'),
    enabled: isConfigured && Boolean(id),
    queryFn: async () => {
      const contact = await selectMaybe<ContactRow>('contacts', (q) =>
        q.eq('id', id).maybeSingle(),
      )
      if (!contact) throw new Error('Contact not found')

      const [{ stats, error }, introducer] = await Promise.all([
        fetchStats([contact.id]),
        contact.introduced_by_id
          ? selectMaybe<ContactRow>('contacts', (q) => q.eq('id', contact.introduced_by_id).maybeSingle())
          : Promise.resolve(null),
      ])

      return {
        contact,
        stats: stats[contact.id] ?? null,
        statsError: error,
        introducedBy: introducer ? { id: introducer.id, name: displayName(introducer) } : null,
      }
    },
  })
}

/* ---------------------------------------------------------------- timeline */

export interface ContactTimelineResult extends TimelineFeed {
  /** Scheduled interactions are kept so the Details tab can show them too. */
  scheduled: InteractionRow[]
}

interface TimelineSources {
  interactions: InteractionRow[]
  donations: DonationRow[]
  declarations: GiftAidDeclarationRow[]
  notes: NoteRow[]
  tasks: TaskRow[]
  installments: PledgeInstallmentRow[]
}

/**
 * The merged feed. The rows are one query; the *presentation* join (fund
 * names, author names, kind labels) happens in a memo, so the feed re-renders
 * with the real names as soon as the reference queries land instead of caching
 * a half-resolved version.
 */
export function useContactTimeline(id: string | undefined): {
  data: ContactTimelineResult | undefined
  isLoading: boolean
  error: unknown
} {
  const refs = useGivingRefs()
  const team = useTeamMembers()
  const kindLabels = useInteractionKindLabels()

  const sources = useQuery<TimelineSources>({
    queryKey: qk.contacts.timeline(id ?? 'none'),
    enabled: isConfigured && Boolean(id),
    queryFn: async () => {
      const [interactions, donations, declarations, notes, tasks, pledges] = await Promise.all([
        selectRows<InteractionRow>('interactions', (q) =>
          q.eq('contact_id', id).order('occurred_at', { ascending: false }).limit(200),
        ),
        selectRows<DonationRow>('donations', (q) =>
          q.eq('contact_id', id).order('donated_on', { ascending: false }).limit(200),
        ),
        selectRows<GiftAidDeclarationRow>('gift_aid_declarations', (q) => q.eq('contact_id', id)),
        selectRows<NoteRow>('notes', (q) =>
          q.eq('contact_id', id).order('created_at', { ascending: false }).limit(200),
        ),
        selectRows<TaskRow>('tasks', (q) => q.eq('contact_id', id).eq('status', 'done').limit(100)),
        selectRows<PledgeRow>('pledges', (q) => q.eq('contact_id', id).eq('status', 'open')),
      ])

      const pledgeIds = pledges.map((p) => p.id)
      const installments =
        pledgeIds.length > 0
          ? await selectRows<PledgeInstallmentRow>('pledge_installments', (q) =>
              q.in('pledge_id', pledgeIds).order('due_on', { ascending: true }),
            )
          : []

      // Only the next installment belongs in "Upcoming" (04 §5.2).
      return { interactions, donations, declarations, notes, tasks, installments: installments.slice(0, 1) }
    },
  })

  const data = useMemo<ContactTimelineResult | undefined>(() => {
    if (!sources.data) return undefined
    const feed = buildTimeline({
      ...sources.data,
      refs: refs.data ?? null,
      team: team.data ?? [],
      kindLabels,
    })
    return { ...feed, scheduled: sources.data.interactions.filter((i) => i.status === 'scheduled') }
  }, [sources.data, refs.data, team.data, kindLabels])

  return { data, isLoading: sources.isLoading, error: sources.error }
}

/* ------------------------------------------------------------------ giving */

export function useContactGiving(id: string | undefined): UseQueryResult<ContactGiving> {
  return useQuery<ContactGiving>({
    queryKey: qk.contacts.giving(id ?? 'none'),
    enabled: isConfigured && Boolean(id),
    queryFn: async () => {
      const [donations, pledges, recurring] = await Promise.all([
        selectRows<DonationRow>('donations', (q) =>
          q.eq('contact_id', id).order('donated_on', { ascending: false }),
        ),
        selectRows<PledgeRow>('pledges', (q) => q.eq('contact_id', id).order('pledged_on', { ascending: false })),
        selectRows<RecurringAgreementRow>('recurring_agreements', (q) => q.eq('contact_id', id)),
      ])
      const pledgeIds = pledges.map((p) => p.id)
      const installments =
        pledgeIds.length > 0
          ? await selectRows<PledgeInstallmentRow>('pledge_installments', (q) =>
              q.in('pledge_id', pledgeIds).order('due_on', { ascending: true }),
            )
          : []
      return { donations, pledges, installments, recurring }
    },
  })
}

/* ------------------------------------------------- notes · docs · tags · GA */

export function useContactNotes(id: string | undefined): UseQueryResult<NoteRow[]> {
  return useQuery<NoteRow[]>({
    queryKey: qk.contacts.notes(id ?? 'none'),
    enabled: isConfigured && Boolean(id),
    queryFn: () =>
      selectRows<NoteRow>('notes', (q) =>
        q.eq('contact_id', id).order('created_at', { ascending: false }),
      ),
  })
}

export function useContactDocuments(id: string | undefined): UseQueryResult<DocumentRow[]> {
  return useQuery<DocumentRow[]>({
    queryKey: qk.contacts.documents(id ?? 'none'),
    enabled: isConfigured && Boolean(id),
    queryFn: () =>
      selectRows<DocumentRow>('documents', (q) =>
        q.eq('contact_id', id).order('created_at', { ascending: false }),
      ),
  })
}

export function useContactTags(id: string | undefined): UseQueryResult<TagRow[]> {
  return useQuery<TagRow[]>({
    queryKey: qk.contacts.tags(id ?? 'none'),
    enabled: isConfigured && Boolean(id),
    queryFn: async () => {
      const taggings = await selectRows<TaggingRow>('taggings', (q) =>
        q.eq('contact_id', id).eq('is_excluded', false),
      )
      const tagIds = taggings.map((t) => t.tag_id)
      if (tagIds.length === 0) return []
      return selectRows<TagRow>('tags', (q) => q.in('id', tagIds).order('category', { ascending: true }))
    },
  })
}

export function useContactDeclarations(id: string | undefined): UseQueryResult<GiftAidDeclarationRow[]> {
  return useQuery<GiftAidDeclarationRow[]>({
    queryKey: qk.contacts.declarations(id ?? 'none'),
    enabled: isConfigured && Boolean(id),
    queryFn: () =>
      selectRows<GiftAidDeclarationRow>('gift_aid_declarations', (q) =>
        q.eq('contact_id', id).order('declared_on', { ascending: false }),
      ),
  })
}

/* --------------------------------------------------------------- household */

export interface HouseholdDetail {
  household: HouseholdRow
  members: ContactListRow[]
  combinedLifetime: number | null
  combinedThisYear: number | null
}

export function useHousehold(householdId: string | null | undefined): UseQueryResult<HouseholdDetail | null> {
  return useQuery<HouseholdDetail | null>({
    queryKey: qk.households.detail(householdId ?? 'none'),
    enabled: isConfigured && Boolean(householdId),
    queryFn: async () => {
      const household = await selectMaybe<HouseholdRow>('households', (q) =>
        q.eq('id', householdId).maybeSingle(),
      )
      if (!household) return null
      const members = await selectRows<ContactRow>('contacts', (q) =>
        q.eq('household_id', householdId).eq('is_archived', false).order('first_name', { ascending: true }),
      )
      const { stats } = await fetchStats(members.map((m) => m.id))
      const rows: ContactListRow[] = members.map((contact) => ({
        contact,
        stats: stats[contact.id] ?? null,
      }))
      const sum = (pick: (s: ContactStats) => number | null): number | null => {
        const values = rows.map((r) => (r.stats ? pick(r.stats) : null)).filter((v): v is number => v !== null)
        return values.length === 0 ? null : values.reduce((a, b) => a + b, 0)
      }
      return {
        household,
        members: rows,
        combinedLifetime: sum((s) => s.lifetime_giving),
        combinedThisYear: sum((s) => s.this_year_giving),
      }
    },
  })
}

/* ------------------------------------------------------- duplicate check */

const DUPLICATE_LIMIT = 25

/**
 * Duplicate check at the door (02 §6): normalised phone/email exact match plus
 * a name match. Candidates are fetched narrowly and scored client-side, which
 * stands in for Postgres `similarity()` until an RPC exists.
 */
export async function findDuplicates(
  signals: DuplicateSignals,
  excludeId?: string,
): Promise<DuplicateMatch[]> {
  const email = normaliseEmail(signals.email)
  const phones = unique(
    [signals.phone, signals.whatsapp].map((p) => normalisePhone(p)).filter((p): p is string => Boolean(p)),
  )
  const lastName = nullable(signals.last_name ?? null)
  const firstName = nullable(signals.first_name)
  const organization = nullable(signals.organization ?? null)

  const queries: Array<Promise<ContactRow[]>> = []
  if (email) {
    queries.push(
      selectRows<ContactRow>('contacts', (q) => q.ilike('email', email).limit(DUPLICATE_LIMIT)),
    )
  }
  for (const phone of phones) {
    queries.push(selectRows<ContactRow>('contacts', (q) => q.eq('phone', phone).limit(DUPLICATE_LIMIT)))
    queries.push(selectRows<ContactRow>('contacts', (q) => q.eq('whatsapp', phone).limit(DUPLICATE_LIMIT)))
  }
  if (lastName) {
    queries.push(
      selectRows<ContactRow>('contacts', (q) => q.ilike('last_name', lastName).limit(DUPLICATE_LIMIT)),
    )
  } else if (firstName) {
    queries.push(
      selectRows<ContactRow>('contacts', (q) => q.ilike('first_name', firstName).limit(DUPLICATE_LIMIT)),
    )
  }
  if (organization) {
    queries.push(
      selectRows<ContactRow>('contacts', (q) =>
        q.ilike('organization', organization).limit(DUPLICATE_LIMIT),
      ),
    )
  }
  if (queries.length === 0) return []

  const results = await Promise.all(queries)
  const candidates = new Map<string, ContactRow>()
  for (const rows of results) {
    for (const row of rows) {
      if (row.id === excludeId) continue
      if (row.is_archived) continue
      candidates.set(row.id, row)
    }
  }

  const matches: DuplicateMatch[] = []
  for (const candidate of candidates.values()) {
    const match = scoreDuplicate(signals, candidate)
    if (match) matches.push(match)
  }
  return rankDuplicates(matches).slice(0, 5)
}

/* --------------------------------------------------------------- mutations */

/** Apply the 02 §6 data-quality rules on the way to the database. */
export function draftToRow(draft: ContactDraft): Record<string, unknown> {
  const phone = normalisePhone(draft.phone)
  const whatsapp = normalisePhone(draft.whatsapp) ?? phone
  const frequency = Number.parseInt(draft.contact_frequency_days, 10)

  return {
    title: nullable(draft.title),
    first_name: draft.first_name.trim(),
    last_name: draft.last_name.trim(),
    hebrew_name: nullable(draft.hebrew_name),
    organization: nullable(draft.organization),
    position: nullable(draft.position),
    contact_kind: nullable(draft.contact_kind) ?? 'individual',
    email: normaliseEmail(draft.email),
    phone,
    whatsapp,
    preferred_language: nullable(draft.preferred_language) ?? 'en',
    preferred_channel: nullable(draft.preferred_channel),
    best_time_to_contact: nullable(draft.best_time_to_contact),
    address_line1: nullable(draft.address_line1),
    address_line2: nullable(draft.address_line2),
    city: nullable(draft.city),
    postcode: nullable(draft.postcode),
    country: nullable(draft.country) ?? 'United Kingdom',
    spouse_name: nullable(draft.spouse_name),
    birthday: nullable(draft.birthday),
    things_to_remember: nullable(draft.things_to_remember),
    introduced_by_note: nullable(draft.introduced_by_note),
    relationship_owner_id: nullable(draft.relationship_owner_id),
    source: nullable(draft.source),
    stage: nullable(draft.stage) ?? 'prospect',
    priority: nullable(draft.priority) ?? 'medium',
    tier: nullable(draft.tier),
    contact_frequency_days: Number.isFinite(frequency) ? frequency : null,
  }
}

/** `qk.contacts.all` is the sweep prefix: lists, detail and derived stats. */
function invalidateContact(client: QueryClient, id: string) {
  void client.invalidateQueries({ queryKey: qk.contacts.detail(id) })
  void client.invalidateQueries({ queryKey: qk.contacts.all })
}

export function useCreateContact() {
  const client = useQueryClient()
  return useMutation<ContactRow, Error, ContactDraft>({
    mutationFn: async (draft) => {
      const { data, error } = await supabase
        .from('contacts')
        .insert(draftToRow(draft))
        .select('*')
        .single()
      if (error) throw new Error((error as Failed).message)
      return (data as unknown) as ContactRow
    },
    onSuccess: (row) => {
      client.setQueryData(qk.contacts.detail(row.id), {
        contact: row,
        stats: null,
        statsError: null,
        introducedBy: null,
      } satisfies ContactDetail)
      void client.invalidateQueries({ queryKey: qk.contacts.all })
    },
  })
}

export interface UpdateContactInput {
  id: string
  patch: Record<string, unknown>
}

export function useUpdateContact() {
  const client = useQueryClient()
  return useMutation<ContactRow, Error, UpdateContactInput, { previous?: ContactDetail }>({
    mutationFn: async ({ id, patch }) => {
      const { data, error } = await supabase
        .from('contacts')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw new Error((error as Failed).message)
      return (data as unknown) as ContactRow
    },
    // Optimistic: the pill/chip changes under the cursor, the write follows.
    onMutate: async ({ id, patch }) => {
      const key = qk.contacts.detail(id)
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<ContactDetail>(key)
      if (previous) {
        client.setQueryData<ContactDetail>(key, {
          ...previous,
          contact: { ...previous.contact, ...(patch as Partial<ContactRow>) },
        })
      }
      return { previous }
    },
    onError: (_error, variables, context) => {
      if (context?.previous) client.setQueryData(qk.contacts.detail(variables.id), context.previous)
    },
    onSettled: (_data, _error, variables) => invalidateContact(client, variables.id),
  })
}

export function useSetArchived() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; archived: boolean }>({
    mutationFn: async ({ id, archived }) => {
      const { error } = await supabase.from('contacts').update({ is_archived: archived }).eq('id', id)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: (_d, _e, variables) => invalidateContact(client, variables.id),
  })
}

/* ------------------------------------------------------------------- notes */

export interface CreateNoteInput {
  contact_id: string
  body: string
  category: string | null
  is_private: boolean
}

export function useCreateNote() {
  const client = useQueryClient()
  return useMutation<NoteRow, Error, CreateNoteInput>({
    mutationFn: async (input) => {
      const { data: session } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('notes')
        .insert({ ...input, created_by: session?.user?.id ?? null })
        .select('*')
        .single()
      if (error) throw new Error((error as Failed).message)
      return (data as unknown) as NoteRow
    },
    onSettled: (_d, _e, input) => {
      void client.invalidateQueries({ queryKey: qk.contacts.notes(input.contact_id) })
      void client.invalidateQueries({ queryKey: qk.contacts.timeline(input.contact_id) })
    },
  })
}

/**
 * One pinned note per contact (D9, partial unique index). The other notes are
 * unpinned first so the index can never reject the write.
 */
export function useSetPinnedNote() {
  const client = useQueryClient()
  return useMutation<void, Error, { contactId: string; noteId: string | null }, { previous?: NoteRow[] }>({
    mutationFn: async ({ contactId, noteId }) => {
      const clear = await supabase
        .from('notes')
        .update({ is_pinned: false })
        .eq('contact_id', contactId)
        .eq('is_pinned', true)
      if (clear.error) throw new Error((clear.error as Failed).message)

      if (noteId) {
        const set = await supabase.from('notes').update({ is_pinned: true }).eq('id', noteId)
        if (set.error) throw new Error((set.error as Failed).message)
      }

      const link = await supabase.from('contacts').update({ pinned_note_id: noteId }).eq('id', contactId)
      if (link.error) throw new Error((link.error as Failed).message)
    },
    onMutate: async ({ contactId, noteId }) => {
      const key = qk.contacts.notes(contactId)
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<NoteRow[]>(key)
      if (previous) {
        client.setQueryData<NoteRow[]>(
          key,
          previous.map((note) => ({ ...note, is_pinned: note.id === noteId })),
        )
      }
      return { previous }
    },
    onError: (_error, variables, context) => {
      if (context?.previous) client.setQueryData(qk.contacts.notes(variables.contactId), context.previous)
    },
    onSettled: (_d, _e, variables) => {
      void client.invalidateQueries({ queryKey: qk.contacts.notes(variables.contactId) })
      void client.invalidateQueries({ queryKey: qk.contacts.detail(variables.contactId) })
      void client.invalidateQueries({ queryKey: qk.contacts.timeline(variables.contactId) })
    },
  })
}

/* --------------------------------------------------------------- documents */

export interface CreateDocumentInput {
  contact_id: string
  title: string
  url: string
  kind: string | null
}

export function useCreateDocument() {
  const client = useQueryClient()
  return useMutation<DocumentRow, Error, CreateDocumentInput>({
    mutationFn: async (input) => {
      const { data, error } = await supabase.from('documents').insert(input).select('*').single()
      if (error) throw new Error((error as Failed).message)
      return (data as unknown) as DocumentRow
    },
    onSettled: (_d, _e, input) => {
      void client.invalidateQueries({ queryKey: qk.contacts.documents(input.contact_id) })
    },
  })
}

/* ------------------------------------------------------- tasks & meetings */

export interface CreateTaskInput {
  contact_id: string
  title: string
  action_type: string | null
  due_on: string | null
  priority: string
}

export function useCreateTask() {
  const client = useQueryClient()
  return useMutation<TaskRow, Error, CreateTaskInput>({
    mutationFn: async (input) => {
      const { data: session } = await supabase.auth.getUser()
      const userId = session?.user?.id ?? null
      const { data, error } = await supabase
        .from('tasks')
        .insert({ ...input, status: 'todo', origin: 'manual', assigned_to: userId, created_by: userId })
        .select('*')
        .single()
      if (error) throw new Error((error as Failed).message)
      return (data as unknown) as TaskRow
    },
    onSettled: (_d, _e, input) => {
      // The next action and the flag both live in contact_stats.
      invalidateContact(client, input.contact_id)
      void client.invalidateQueries({ queryKey: qk.tasks.all })
    },
  })
}

export interface ScheduleMeetingInput {
  contact_id: string
  occurred_at: string
  summary: string
  purpose: string | null
  location: string | null
}

/** A future `status='scheduled'` interaction is an upcoming meeting (02 §3.2). */
export function useScheduleMeeting() {
  const client = useQueryClient()
  return useMutation<InteractionRow, Error, ScheduleMeetingInput>({
    mutationFn: async (input) => {
      const { data: session } = await supabase.auth.getUser()
      const userId = session?.user?.id ?? null
      const { data, error } = await supabase
        .from('interactions')
        .insert({
          ...input,
          kind: 'meeting',
          status: 'scheduled',
          is_meaningful: false,
          source: 'manual',
          team_member_id: userId,
          created_by: userId,
        })
        .select('*')
        .single()
      if (error) throw new Error((error as Failed).message)
      return (data as unknown) as InteractionRow
    },
    onSettled: (_d, _e, input) => {
      void client.invalidateQueries({ queryKey: qk.contacts.timeline(input.contact_id) })
      invalidateContact(client, input.contact_id)
    },
  })
}
