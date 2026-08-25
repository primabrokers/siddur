import { EmptyState } from '../components'
import { PageHeader } from '../features/shell/PageHeader'
import { useAuth } from '../features/auth/AuthProvider'
import { useTeamMember } from '../features/auth/useTeamMember'

/**
 * Settings — team, lookups, automation rules, digest preferences.
 *
 * TODO(settings): lookup_options editor, automation_rules switches, digest
 * hour/channel, drafting examples, and the admin-only import/merge tools.
 */
export function SettingsRoute() {
  const { user } = useAuth()
  const { data: member, isPending } = useTeamMember()

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle={
          isPending
            ? 'Loading your profile…'
            : member
              ? `${member.full_name} · ${member.role}`
              : (user?.email ?? 'Not signed in')
        }
      />
      <EmptyState
        title="Settings land here"
        hint="Team members and roles, every dropdown's lookup list, the automation-rule switches and their parameters, morning-digest preferences, and the AI drafting tone samples."
      />
    </>
  )
}
