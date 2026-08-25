import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { qk } from '../../lib/queries/keys'
import { useAuth } from './AuthProvider'

export type TeamRole = 'admin' | 'fundraiser' | 'viewer'

/**
 * Local shape, deliberately narrow. `team_members.id` *is* `auth.users.id`
 * (schema-v2 §team_members), so the session user id is the primary key.
 *
 * Annotated locally rather than inferred from `Database`, so the generated
 * types landing later cannot break this call site.
 */
export interface TeamMember {
  id: string
  role: TeamRole
  full_name: string
}

export function useTeamMember(): UseQueryResult<TeamMember | null> {
  const { user, loading } = useAuth()
  const userId = user?.id ?? null

  return useQuery<TeamMember | null>({
    queryKey: qk.teamMember.byUser(userId),
    enabled: !loading && Boolean(userId),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!userId) return null
      const { data, error } = await supabase
        .from('team_members')
        .select('id, role, full_name')
        .eq('id', userId)
        .maybeSingle()

      if (error) throw error
      // Double cast on purpose: `Database` is `any` today and a concrete row
      // type tomorrow. This keeps the call site compiling either way while the
      // local interface stays the contract for consumers.
      return (data as unknown as TeamMember | null) ?? null
    },
  })
}

export const isAdmin = (member: TeamMember | null | undefined): boolean => member?.role === 'admin'
export const canEdit = (member: TeamMember | null | undefined): boolean =>
  member?.role === 'admin' || member?.role === 'fundraiser'
