/**
 * Settings data access (06 §4).
 *
 * Every write here is admin-only *in Postgres* (11 §1 / `002_rls.sql`), so the
 * UI's role gate is a courtesy — a non-admin who reached a mutation would be
 * refused by the database, which is the boundary that counts (11 §2).
 *
 * Two settings groups have no table of their own and are stored as
 * `automation_rules` rows — `org_details` and `ai_features`. The tradeoff is
 * recorded in `ORG_DETAILS_KEY` below.
 */

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../supabase'
import { isConfigured } from '../env'
import { qk } from './keys'
import { selectRows } from './rest'
import type { TeamRole } from '../../features/auth/useTeamMember'

interface Failed {
  message: string
}

/* --------------------------------------------------------------- lookups */

/** 02 §6 — the row behind every dropdown in the product. */
export interface LookupOptionRow {
  id: string
  list_name: string
  value: string
  label: string
  sort_order: number
  color: string | null
  is_active: boolean
  meta: Record<string, unknown> | null
}

/** Every option of one list, retired ones included (retiring never deletes). */
export function useLookupList(listName: string): UseQueryResult<LookupOptionRow[]> {
  return useQuery<LookupOptionRow[]>({
    queryKey: qk.lookups.admin(listName),
    enabled: isConfigured && listName !== '',
    staleTime: 60_000,
    queryFn: () =>
      selectRows<LookupOptionRow>('lookup_options', (q) =>
        q.eq('list_name', listName).order('sort_order', { ascending: true }),
      ),
  })
}

/** The editor's list picker. One small read; the table is ~100 rows (02 §6). */
export function useLookupListNames(): UseQueryResult<string[]> {
  return useQuery<string[]>({
    queryKey: qk.lookups.names(),
    enabled: isConfigured,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const rows = await selectRows<{ list_name: string }>('lookup_options', (q) =>
        q.order('list_name', { ascending: true }),
      )
      return [...new Set(rows.map((row) => row.list_name))].sort()
    },
  })
}

export interface LookupPatch {
  label?: string
  sort_order?: number
  color?: string | null
  is_active?: boolean
}

export function useUpdateLookupOption() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; listName: string; patch: LookupPatch }>({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('lookup_options').update(patch).eq('id', id)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: (_d, _e, variables) => {
      void client.invalidateQueries({ queryKey: qk.lookups.admin(variables.listName) })
      void client.invalidateQueries({ queryKey: qk.lookups.list(variables.listName) })
    },
  })
}

export interface NewLookupOption {
  list_name: string
  value: string
  label: string
  sort_order: number
  color: string | null
}

export function useCreateLookupOption() {
  const client = useQueryClient()
  return useMutation<void, Error, NewLookupOption>({
    mutationFn: async (input) => {
      const { error } = await supabase.from('lookup_options').insert({ ...input, is_active: true })
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: (_d, _e, input) => {
      void client.invalidateQueries({ queryKey: qk.lookups.admin(input.list_name) })
      void client.invalidateQueries({ queryKey: qk.lookups.list(input.list_name) })
      void client.invalidateQueries({ queryKey: qk.lookups.names() })
    },
  })
}

/* ------------------------------------------------------- automation rules */

export interface AutomationRuleRow {
  rule_key: string
  is_enabled: boolean
  params: Record<string, unknown>
  updated_at: string | null
}

export function useAutomationRules(): UseQueryResult<AutomationRuleRow[]> {
  return useQuery<AutomationRuleRow[]>({
    queryKey: qk.settings.automationRules(),
    enabled: isConfigured,
    staleTime: 60_000,
    queryFn: () =>
      selectRows<AutomationRuleRow>('automation_rules', (q) =>
        q.order('rule_key', { ascending: true }),
      ),
  })
}

export interface RulePatch {
  is_enabled?: boolean
  params?: Record<string, unknown>
}

/**
 * Toggling or retuning a rule. `upsert` rather than `update`, because the two
 * settings-only keys (`org_details`, `ai_features`) may not have a row yet.
 */
export function useUpdateAutomationRule() {
  const client = useQueryClient()
  return useMutation<void, Error, { rule_key: string; patch: RulePatch }>({
    mutationFn: async ({ rule_key, patch }) => {
      const { error } = await supabase
        .from('automation_rules')
        .upsert(
          { rule_key, is_enabled: patch.is_enabled ?? true, ...(patch.params ? { params: patch.params } : {}), updated_at: new Date().toISOString() },
          { onConflict: 'rule_key' },
        )
      if (error) throw new Error((error as Failed).message)
    },
    onMutate: async ({ rule_key, patch }) => {
      // Optimistic: the switch moves under the finger, the write follows (I-12).
      await client.cancelQueries({ queryKey: qk.settings.automationRules() })
      client.setQueryData<AutomationRuleRow[]>(qk.settings.automationRules(), (rows) =>
        rows?.map((row) =>
          row.rule_key === rule_key
            ? {
                ...row,
                ...(patch.is_enabled !== undefined ? { is_enabled: patch.is_enabled } : {}),
                ...(patch.params ? { params: patch.params } : {}),
              }
            : row,
        ),
      )
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.settings.automationRules() })
    },
  })
}

/* -------------------------------------------------------- org details / AI */

/**
 * Organisation details (charity number, HMRC reference — they feed the Gift Aid
 * export, 05 §5) live in `automation_rules('org_details').params`.
 *
 * **Tradeoff, stated plainly.** A dedicated `org_settings` table would be the
 * honest home for them, but adding one is a schema migration owned by the data
 * model (02), and M5 is additive by contract. `automation_rules` is already the
 * "one configurable row per key" table with exactly the right RLS (admin
 * writes, members read) and an audit trigger (11 §4), so the row rides there
 * with `is_enabled` unused. If 02 ever grows `org_settings`, this is a
 * three-line move and the UI does not change.
 */
export const ORG_DETAILS_KEY = 'org_details'
/** Per-feature AI switches (09 §1 / 06 §4), same storage, same tradeoff. */
export const AI_FEATURES_KEY = 'ai_features'

export interface OrgDetails {
  name: string
  charity_number: string
  hmrc_reference: string
  /** Gift Aid claims are made in the name of the authorised official. */
  contact_email: string
}

export const EMPTY_ORG: OrgDetails = {
  name: '',
  charity_number: '',
  hmrc_reference: '',
  contact_email: '',
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function readOrgDetails(rules: AutomationRuleRow[] | undefined): OrgDetails {
  const params = rules?.find((rule) => rule.rule_key === ORG_DETAILS_KEY)?.params ?? {}
  return {
    name: text(params.name),
    charity_number: text(params.charity_number),
    hmrc_reference: text(params.hmrc_reference),
    contact_email: text(params.contact_email),
  }
}

export function readAiFeatures(rules: AutomationRuleRow[] | undefined): Record<string, boolean> {
  const params = rules?.find((rule) => rule.rule_key === AI_FEATURES_KEY)?.params ?? {}
  const out: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(params)) out[key] = value === true
  return out
}

/* ------------------------------------------------------------------- team */

export interface TeamMemberRow {
  id: string
  full_name: string
  email: string
  role: TeamRole
  can_see_amounts: boolean
  digest_hour: number
  digest_channel: string
  is_active: boolean
}

export function useTeamRoster(): UseQueryResult<TeamMemberRow[]> {
  return useQuery<TeamMemberRow[]>({
    queryKey: qk.settings.team(),
    enabled: isConfigured,
    staleTime: 60_000,
    queryFn: () =>
      selectRows<TeamMemberRow>('team_members', (q) => q.order('full_name', { ascending: true })),
  })
}

export interface TeamPatch {
  role?: TeamRole
  can_see_amounts?: boolean
  digest_hour?: number
  digest_channel?: string
  is_active?: boolean
}

export function useUpdateTeamMember() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; patch: TeamPatch }>({
    mutationFn: async ({ id, patch }) => {
      const { error } = await supabase.from('team_members').update(patch).eq('id', id)
      if (error) throw new Error((error as Failed).message)
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: qk.settings.team() })
      void client.invalidateQueries({ queryKey: qk.team.all })
      void client.invalidateQueries({ queryKey: qk.teamMember.all })
    },
  })
}
