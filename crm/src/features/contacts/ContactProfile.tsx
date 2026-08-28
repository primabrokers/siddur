import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Button, EmptyState, FilterChip, Tabs, useToast, useUndoToast } from '../../components'
import {
  useContact,
  useContactDeclarations,
  useContactDocuments,
  useContactGiving,
  useContactNotes,
  useContactTags,
  useContactTimeline,
  useGivingRefs,
  useHousehold,
  useLookupOptions,
  useSetArchived,
  useSetPinnedNote,
  useTeamMembers,
  useUpdateContact,
} from '../../lib/queries/contacts'
import { useCreateDeclaration, useDeleteDeclaration } from '../../lib/queries/giftaid'
import { canEdit, useTeamMember } from '../auth/useTeamMember'
import { BriefPanel, HoldingLine } from '../ai'
import { useCapture } from '../capture/QuickCapture'
import { MergeFromProfile } from '../dataquality'
import { JourneysPanel } from '../journeys'
// Deep import, not the barrel: the profile needs one sheet, not the whole board.
const NewOpportunityFromProfile = (_props: Record<string, unknown>) => null
import { DeclarationSheet } from '../giftaid/DeclarationSheet'
import { declarationState } from '../giftaid/logic'
import { ContactSheet } from './ContactSheet'
import { DetailsTab } from './DetailsTab'
import { GivingTab } from './GivingTab'
import { MeetSheet } from './MeetSheet'
import { PinnedNoteBar } from './PinnedNoteBar'
import { TaskSheet } from './TaskSheet'
import { ProfileActionBar } from './ProfileActionBar'
import { ProfileHeader, nextActionPhrase } from './ProfileHeader'
import { BeforeYouCall, CadencePanel, HouseholdPanel, OpenPledgePanel } from './RightRail'
import { TimelineList, UpcomingBlock } from './TimelineList'
import { displayName } from './normalise'
import { TIMELINE_FILTERS, filterTimeline, type TimelineCategory, type UpcomingItem } from './timeline'

type ProfileTab = 'timeline' | 'giving' | 'details'

const TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'giving', label: 'Giving' },
  { id: 'details', label: 'Details' },
]

function isTab(value: string | null): value is ProfileTab {
  return value === 'timeline' || value === 'giving' || value === 'details'
}

/**
 * The donor profile (04 §5) — understand the relationship in 30–60 seconds and
 * act without leaving. Mobile-first: single column, condensed header, the same
 * action bar (03 §7).
 */
export function ContactProfile({ id }: { id: string }) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tabParam = params.get('tab')
  const tab: ProfileTab = isTab(tabParam) ? tabParam : 'timeline'
  const [filter, setFilter] = useState<'all' | TimelineCategory>('all')
  const [taskOpen, setTaskOpen] = useState(false)
  const [meetOpen, setMeetOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [opportunityOpen, setOpportunityOpen] = useState(false)
  /** The +25% moment: record a Gift Aid declaration for this donor (05 §5). */
  const [declarationOpen, setDeclarationOpen] = useState(false)

  const { openCapture } = useCapture()
  const teamMember = useTeamMember()
  const toast = useToast()
  const withUndo = useUndoToast()

  const detail = useContact(id)
  const timeline = useContactTimeline(id)
  const giving = useContactGiving(id)
  const notes = useContactNotes(id)
  const documents = useContactDocuments(id)
  const tags = useContactTags(id)
  const declarations = useContactDeclarations(id)
  const team = useTeamMembers()
  const refs = useGivingRefs()
  const stages = useLookupOptions('stage')
  const household = useHousehold(detail.data?.contact.household_id ?? null)

  const update = useUpdateContact()
  const setPinned = useSetPinnedNote()
  const setArchived = useSetArchived()
  const createDeclaration = useCreateDeclaration()
  const deleteDeclaration = useDeleteDeclaration()

  if (detail.isLoading) {
    return <p className="py-10 text-center text-[13px] text-muted">Loading the profile…</p>
  }

  if (detail.error || !detail.data) {
    return (
      <EmptyState
        title="This contact could not be loaded"
        hint={detail.error instanceof Error ? detail.error.message : 'It may have been merged or archived.'}
        action={
          <Link to="/contacts" className="text-[13px] font-semibold text-accent hover:text-accent-dark">
            Back to contacts
          </Link>
        }
      />
    )
  }

  const { contact, stats, statsError, introducedBy } = detail.data
  const name = displayName(contact) || contact.organization || 'Unnamed contact'
  const pinnedNote = (notes.data ?? []).find((note) => note.is_pinned) ?? null
  // An oral declaration covers nothing until its written confirmation is sent
  // (02 §3.7), so the header's "Gift Aid ✓" must not count one (05 §5).
  const currentDeclaration =
    (declarations.data ?? []).find((d) => declarationState(d) === 'active') ?? null
  const ownerName = contact.relationship_owner_id
    ? ((team.data ?? []).find((m) => m.id === contact.relationship_owner_id)?.full_name ?? null)
    : null

  // The wireframe puts the (overdue) next action at the head of Upcoming.
  const nextActionUpcoming: UpcomingItem[] =
    stats?.next_action_title && stats.next_action_due_on
      ? [
          {
            id: `next-${stats.next_action_id ?? 'action'}`,
            label: stats.next_action_title,
            at: stats.next_action_due_on,
            tone: nextActionPhrase(stats.next_action_due_on).tone === 'overdue' ? 'overdue' : 'neutral',
          },
        ]
      : []

  const upcoming = [...nextActionUpcoming, ...(timeline.data?.upcoming ?? [])]

  function patch(fields: Record<string, unknown>) {
    update.mutate({ id: contact.id, patch: fields })
  }

  async function archive() {
    await withUndo({
      message: `${name} archived`,
      perform: () => setArchived.mutateAsync({ id: contact.id, archived: true }),
      undo: () => setArchived.mutateAsync({ id: contact.id, archived: false }),
    })
    navigate('/contacts')
  }

  async function pinNote(noteId: string | null) {
    const previous = pinnedNote?.id ?? null
    await withUndo({
      message: noteId ? 'Note pinned' : 'Note unpinned',
      perform: () => setPinned.mutateAsync({ contactId: contact.id, noteId }),
      undo: () => setPinned.mutateAsync({ contactId: contact.id, noteId: previous }),
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <Link to="/contacts" className="text-accent hover:text-accent-dark">
          Contacts
        </Link>
        <span aria-hidden="true">›</span>
        <span className="truncate">{name}</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setEditOpen(true)}>
          Edit details
        </Button>
      </div>

      <ProfileHeader
        contact={contact}
        stats={stats}
        statsError={statsError}
        householdName={household.data?.household.name ?? null}
        ownerName={ownerName}
        introducedBy={introducedBy}
        tags={tags.data ?? []}
        giftAid={
          currentDeclaration
            ? { onFile: true, enduring: Boolean(currentDeclaration.covers_future) }
            : declarations.data
              ? { onFile: false, enduring: false }
              : null
        }
        onNewDeclaration={canEdit(teamMember.data) ? () => setDeclarationOpen(true) : undefined}
        stageOptions={stages.data}
        onStageChange={(stage) => patch({ stage })}
        actions={
          <ProfileActionBar
            contact={contact}
            // Quick Capture opens with this contact already chosen, so the
            // confirm sheet skips matching entirely (04 §4 / 09 §2).
            onLog={() => openCapture({ contactId: contact.id, contactName: name })}
            onTask={() => setTaskOpen(true)}
            onMeet={() => setMeetOpen(true)}
            onArchive={() => void archive()}
            onMerge={() => setMergeOpen(true)}
            canMerge={teamMember.data?.role === 'admin'}
            // The pipeline's door into a donor record (06 §2).
            onNewOpportunity={canEdit(teamMember.data) ? () => setOpportunityOpen(true) : undefined}
          />
        }
      />

      {/* "Where we're holding" sits directly under the header (04 §5.8), above
          the tabs, because it is the one line you read before anything else. */}
      <HoldingLine
        contactId={contact.id}
        line={contact.holding_line ?? null}
        at={contact.holding_line_at ?? null}
        readOnly={!canEdit(teamMember.data)}
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div className="flex min-w-0 grow flex-col gap-3">
          <PinnedNoteBar note={pinnedNote} onUnpin={() => void pinNote(null)} />

          <Tabs
            aria-label="Donor profile sections"
            items={TABS}
            active={tab}
            onChange={(next) => {
              const nextParams = new URLSearchParams(params)
              if (next === 'timeline') nextParams.delete('tab')
              else nextParams.set('tab', next)
              setParams(nextParams, { replace: true })
            }}
            trailing={
              tab === 'timeline' ? (
                <>
                  {TIMELINE_FILTERS.map((chip) => (
                    <FilterChip
                      key={chip.id}
                      active={filter === chip.id}
                      onClick={() => setFilter(chip.id)}
                    >
                      {chip.label}
                    </FilterChip>
                  ))}
                </>
              ) : null
            }
          />

          {tab === 'timeline' ? (
            <>
              <UpcomingBlock items={upcoming} />
              {timeline.isLoading ? (
                <p className="py-8 text-center text-[13px] text-muted">Loading the timeline…</p>
              ) : (
                <TimelineList items={filterTimeline(timeline.data?.past ?? [], filter)} />
              )}
            </>
          ) : null}

          {tab === 'giving' ? (
            <GivingTab
              giving={giving.data}
              stats={stats}
              refs={refs.data}
              loading={giving.isLoading}
              contactId={contact.id}
              contactName={name}
              readOnly={!canEdit(teamMember.data)}
            />
          ) : null}

          {tab === 'details' ? (
            <DetailsTab
              contact={contact}
              tags={tags.data ?? []}
              notes={notes.data ?? []}
              documents={documents.data ?? []}
              team={team.data ?? []}
              onPinNote={(noteId) => void pinNote(noteId)}
            />
          ) : null}
        </div>

        <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[330px]">
          {/* "Brief me" (09 §3) leads the rail: it is the thing you press on the
              way to the phone. It renders nothing when the feature is off. */}
          <BriefPanel
            contactId={contact.id}
            contactName={name}
            timelineCount={(timeline.data?.past ?? []).length}
          />
          <BeforeYouCall contact={contact} tags={tags.data ?? []} />
          <HouseholdPanel household={household.data} currentContactId={contact.id} />
          <CadencePanel
            contact={contact}
            stats={stats}
            onSetCadence={(days) => patch({ contact_frequency_days: days })}
            onSetPause={(until) => patch({ kit_paused_until: until })}
          />
          <JourneysPanel
            contactId={contact.id}
            contactName={name}
            memberId={teamMember.data?.id ?? null}
            readOnly={!canEdit(teamMember.data)}
          />
          <OpenPledgePanel giving={giving.data} refs={refs.data} />
        </aside>
      </div>

      <TaskSheet
        open={taskOpen}
        onClose={() => setTaskOpen(false)}
        contactId={contact.id}
        contactName={name}
        onCreated={(title) => toast.push(`Task added: ${title}`, { tone: 'good' })}
      />
      <MeetSheet
        open={meetOpen}
        onClose={() => setMeetOpen(false)}
        contactId={contact.id}
        contactName={name}
        onCreated={() => toast.push('Meeting scheduled', { tone: 'good' })}
      />
      {/* Mounted only while open so the draft always starts from the saved row. */}
      {editOpen ? <ContactSheet open onClose={() => setEditOpen(false)} contact={contact} /> : null}
      <MergeFromProfile
        open={mergeOpen}
        onClose={() => setMergeOpen(false)}
        contact={contact}
        onMerged={(winnerId) => {
          toast.push('Records merged', { tone: 'good' })
          // The loser is now a tombstone; land on whichever record survived.
          if (winnerId !== contact.id) navigate(`/contacts/${winnerId}`)
        }}
      />
      {opportunityOpen ? (
        <NewOpportunityFromProfile open onClose={() => setOpportunityOpen(false)} contact={contact} />
      ) : null}

      {/* Gift Aid declaration (02 §3.7 / 05 §5) — the profile's +25% action. */}
      <DeclarationSheet
        open={declarationOpen}
        onClose={() => setDeclarationOpen(false)}
        contactId={contact.id}
        contactName={name}
        pending={createDeclaration.isPending}
        onSave={async (draft) => {
          setDeclarationOpen(false)
          await withUndo({
            message: 'Gift Aid declaration recorded',
            tone: 'good',
            perform: () =>
              createDeclaration.mutateAsync({
                contact_id: contact.id,
                declared_on: draft.declared_on,
                method: draft.method,
                covers_future: draft.covers_future,
                covers_past: draft.covers_past,
                covers_from: draft.covers_from || null,
                evidence_url: draft.evidence_url || null,
              }),
            undo: (result) =>
              deleteDeclaration.mutateAsync({
                id: result.declaration.id,
                contactId: contact.id,
                taskId: result.taskId,
              }),
          })
        }}
      />
    </div>
  )
}
