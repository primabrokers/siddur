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
import { useCapture } from '../capture/QuickCapture'
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

  const { openCapture } = useCapture()
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
  const currentDeclaration = (declarations.data ?? []).find((d) => !d.cancelled_on) ?? null
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
        stageOptions={stages.data}
        onStageChange={(stage) => patch({ stage })}
        actions={
          <ProfileActionBar
            contact={contact}
            onLog={() => {
              // TODO(M3): pass the contact through to Quick Capture — the
              // provider's API is `openCapture()` only today (features/capture).
              openCapture()
            }}
            onTask={() => setTaskOpen(true)}
            onMeet={() => setMeetOpen(true)}
            onArchive={() => void archive()}
          />
        }
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
          <BeforeYouCall contact={contact} tags={tags.data ?? []} />
          <HouseholdPanel household={household.data} currentContactId={contact.id} />
          <CadencePanel
            contact={contact}
            stats={stats}
            onSetCadence={(days) => patch({ contact_frequency_days: days })}
            onSetPause={(until) => patch({ kit_paused_until: until })}
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
    </div>
  )
}
