import { useState } from 'react'
import { Pill, Tabs } from '../../components'
import { useAuth } from '../auth/AuthProvider'
import { useTeamMember } from '../auth/useTeamMember'
import { PageHeader } from '../shell/PageHeader'
import { AiTab } from './AiTab'
import { AutomationTab } from './AutomationTab'
import { LookupsTab } from './LookupsTab'
import { OrganisationTab } from './OrganisationTab'
import { TeamTab } from './TeamTab'

type SettingsTab = 'lookups' | 'automation' | 'team' | 'organisation' | 'ai'

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'lookups', label: 'Lookups' },
  { id: 'automation', label: 'Automation rules' },
  { id: 'team', label: 'Team' },
  { id: 'organisation', label: 'Organisation' },
  { id: 'ai', label: 'AI' },
]

/**
 * Settings (06 §4) — the few things that genuinely are global. Everything a
 * fundraiser tunes about *one relationship* stays inline on that relationship
 * (I-6); what lands here is the shared vocabulary (lookups), the engine's
 * parameters (automation rules), who may do what (team), the organisation's
 * own identity, and the AI switches.
 *
 * **Admin-gated, and honestly so.** A non-admin sees the same information
 * read-only: the write policies live in Postgres (11 §1), so hiding the screen
 * would only hide the truth, not enforce it. The controls are disabled and the
 * banner says why.
 */
export function SettingsView() {
  const { user } = useAuth()
  const { data: member, isPending } = useTeamMember()
  const [tab, setTab] = useState<SettingsTab>('lookups')

  const isAdmin = member?.role === 'admin'
  const readOnly = !isAdmin

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
        actions={isAdmin ? <Pill tone="accent">Admin</Pill> : <Pill>Read only</Pill>}
      />

      {readOnly ? (
        <p className="mb-3 rounded-input bg-[#FCF0E3] px-3 py-2 text-[12.5px] text-flag-today-ink">
          You can see how the system is configured, but only an admin can change it. The database enforces
          this, not this screen (11 §1).
        </p>
      ) : null}

      <Tabs
        items={TABS}
        active={tab}
        onChange={setTab}
        aria-label="Settings sections"
        className="mb-4"
      />

      {tab === 'lookups' ? <LookupsTab readOnly={readOnly} /> : null}
      {tab === 'automation' ? <AutomationTab readOnly={readOnly} /> : null}
      {tab === 'team' ? <TeamTab readOnly={readOnly} selfId={member?.id ?? null} /> : null}
      {tab === 'organisation' ? <OrganisationTab readOnly={readOnly} /> : null}
      {tab === 'ai' ? <AiTab readOnly={readOnly} /> : null}
    </>
  )
}
