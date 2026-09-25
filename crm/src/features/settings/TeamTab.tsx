import { Pill, Select } from '../../components'
import { useTeamRoster, useUpdateTeamMember } from '../../lib/queries/settings'
import type { TeamRole } from '../auth/useTeamMember'

const ROLES: Array<{ value: TeamRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'fundraiser', label: 'Fundraiser' },
  { value: 'viewer', label: 'Viewer' },
]

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: String(hour),
  label: `${String(hour).padStart(2, '0')}:00`,
}))

export interface TeamTabProps {
  readOnly: boolean
  /** The signed-in member — their own row is labelled, never role-editable. */
  selfId: string | null
}

/**
 * Team & roles (06 §4, 11 §1).
 *
 * The switches here are a *reflection* of the RLS matrix, never its
 * implementation: changing a role changes what Postgres will return, which is
 * why an admin cannot demote themselves out of the screen by accident — their
 * own role select is disabled.
 *
 * TODO(invites): sending an invitation needs a server-side call to the Auth
 * admin API (a team member's id *is* their `auth.users` id), so it belongs in
 * an edge function rather than the browser. Until it exists, a new member is
 * created by an admin in the Supabase dashboard and appears here on next load.
 */
export function TeamTab({ readOnly, selfId }: TeamTabProps) {
  const roster = useTeamRoster()
  const update = useUpdateTeamMember()

  if (roster.isLoading) {
    return <div className="h-[200px] animate-pulse rounded-card border border-border bg-surface" />
  }

  const rows = roster.data ?? []

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-card border border-border bg-surface px-4 py-2">
        <table className="w-full min-w-[620px] text-left text-[13px]">
          <thead>
            <tr className="text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">
              <th className="py-2 pr-3 font-semibold">Member</th>
              <th className="py-2 pr-3 font-semibold">Role</th>
              <th className="py-2 pr-3 font-semibold">Sees amounts</th>
              <th className="py-2 pr-3 font-semibold">Digest</th>
              <th className="py-2 font-semibold">Active</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((member) => {
              const isSelf = member.id === selfId
              return (
                <tr key={member.id} className="border-t border-border align-middle">
                  <td className="py-[10px] pr-3">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{member.full_name}</span>
                      {isSelf ? <Pill>You</Pill> : null}
                    </div>
                    <div className="text-[11.5px] text-faint">{member.email}</div>
                  </td>
                  <td className="py-[10px] pr-3">
                    <div className="w-[140px]">
                      <Select
                        aria-label={`Role for ${member.full_name}`}
                        value={member.role}
                        disabled={readOnly || isSelf}
                        options={ROLES}
                        onChange={(event) =>
                          update.mutate({ id: member.id, patch: { role: event.target.value as TeamRole } })
                        }
                        className="py-[5px] text-[12.5px]"
                      />
                    </div>
                  </td>
                  <td className="py-[10px] pr-3">
                    {member.role === 'viewer' ? (
                      <label className="flex items-center gap-2 text-[12.5px] text-muted">
                        <input
                          type="checkbox"
                          disabled={readOnly}
                          checked={member.can_see_amounts}
                          aria-label={`${member.full_name} can see amounts`}
                          onChange={(event) =>
                            update.mutate({
                              id: member.id,
                              patch: { can_see_amounts: event.target.checked },
                            })
                          }
                        />
                        {member.can_see_amounts ? 'Yes' : 'No'}
                      </label>
                    ) : (
                      <span className="text-[12.5px] text-faint" title="Admins and fundraisers always see amounts">
                        Always
                      </span>
                    )}
                  </td>
                  <td className="py-[10px] pr-3">
                    <div className="w-[96px]">
                      <Select
                        aria-label={`Digest hour for ${member.full_name}`}
                        value={String(member.digest_hour)}
                        disabled={readOnly}
                        options={HOURS}
                        onChange={(event) =>
                          update.mutate({
                            id: member.id,
                            patch: { digest_hour: Number(event.target.value) },
                          })
                        }
                        className="py-[5px] text-[12.5px]"
                      />
                    </div>
                  </td>
                  <td className="py-[10px]">
                    <label className="flex items-center gap-2 text-[12.5px] text-muted">
                      <input
                        type="checkbox"
                        disabled={readOnly || isSelf}
                        checked={member.is_active}
                        aria-label={`${member.full_name} is active`}
                        onChange={(event) =>
                          update.mutate({ id: member.id, patch: { is_active: event.target.checked } })
                        }
                      />
                      {member.is_active ? 'Active' : 'Suspended'}
                    </label>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[12px] text-muted">
        Invitations are not sent from here yet — an admin adds the person in Supabase Auth and their row
        appears above. Roles are enforced by the database, not by this screen (11 §2).
      </p>

      {update.error ? (
        <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {update.error.message}
        </p>
      ) : null}
    </div>
  )
}
