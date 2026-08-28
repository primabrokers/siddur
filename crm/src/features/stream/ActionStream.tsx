import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  Button,
  Menu,
  RewardState,
  SectionLabel,
  Tabs,
  useToast,
  useUndoToast,
} from '../../components'
import { cn } from '../../lib/cn'
import { formatDayHeading } from '../../lib/format'
import { useLookupOptions } from '../../lib/queries/contacts'
import { useMonthGiving, useRescheduleTasks, useTaskBoard, useUpdateTask } from '../../lib/queries/tasks'
import { useTeamMember } from '../auth/useTeamMember'
import { PageHeader } from '../shell/PageHeader'
import { TaskSheet } from '../tasks/TaskSheet'
import { useTaskCompletion } from '../tasks/completion'
import {
  filterBoard,
  hasOwnTasks,
  rescheduleAllPlan,
  snoozedDueOn,
  type TaskScope,
} from '../tasks/logic'
import { EMPTY_BOARD, type TaskRecord } from '../tasks/types'
import { FocusMode } from './FocusMode'
import { MetricStrip, type MetricFocus } from './MetricStrip'
import { NudgeRail } from './NudgeRail'
import { StreamRow } from './StreamRow'
import {
  buildDoneSections,
  buildTodaySections,
  buildUpcomingSections,
  streamMetrics,
  type StreamRowModel,
  type StreamSection,
} from './grouping'

type StreamTab = 'today' | 'upcoming' | 'done'

const FOCUS_SECTIONS: Record<MetricFocus, (section: StreamSection) => boolean> = {
  all: () => true,
  due: (section) => section.kind === 'due' || section.kind === 'kit',
  overdue: (section) => section.kind === 'overdue',
  meetings: (section) => section.kind === 'meetings',
}

/**
 * The Action Stream (04 §1) — the home screen. A queue of *people*, each
 * carrying their single next action, grouped in the spec's order and sorted
 * red → orange → yellow → blue → grey (I-1/I-3).
 *
 * Everything is live query: open tasks, today's scheduled interactions, the
 * signals table and `contact_stats`. No dashboard state is stored (I-9).
 */
export function ActionStream() {
  const board = useTaskBoard()
  const member = useTeamMember()
  const stages = useLookupOptions('stage')
  const actionTypes = useLookupOptions('action_type')
  const completion = useTaskCompletion()
  const updateTask = useUpdateTask()
  const reschedule = useRescheduleTasks()
  const withUndo = useUndoToast()
  const toast = useToast()

  const [tab, setTab] = useState<StreamTab>('today')
  const [focus, setFocus] = useState<MetricFocus>('all')
  const [scopeOverride, setScopeOverride] = useState<TaskScope | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [taskFor, setTaskFor] = useState<{ id: string; name: string; actionType?: string } | null>(null)

  const raw = board.data ?? EMPTY_BOARD
  const memberId = member.data?.id ?? null
  // Viewers read the stream; they never complete, snooze or create (11 §2).
  const readOnly = member.data?.role === 'viewer'
  const canSeeAmounts = !readOnly

  // Default to my own queue when I have one; a shared inbox otherwise, so the
  // stream is never mysteriously empty on a fresh install.
  const scope: TaskScope = scopeOverride ?? (hasOwnTasks(raw, memberId) ? 'mine' : 'everyone')
  const data = useMemo(() => filterBoard(raw, { memberId, scope }), [raw, memberId, scope])

  const stageLabels = useMemo(
    () => Object.fromEntries((stages.data ?? []).map((o) => [o.value, o.label])),
    [stages.data],
  )
  const actionLabels = useMemo(
    () => Object.fromEntries((actionTypes.data ?? []).map((o) => [o.value, o.label])),
    [actionTypes.data],
  )

  const metrics = useMemo(() => streamMetrics(data), [data])
  const monthGiving = useMonthGiving(canSeeAmounts)

  const todaySections = useMemo(
    () => buildTodaySections(data, { actionLabels }),
    [data, actionLabels],
  )
  const upcomingSections = useMemo(() => buildUpcomingSections(data), [data])
  const doneSections = useMemo(() => buildDoneSections(data), [data])

  const sections =
    tab === 'today'
      ? todaySections.filter(FOCUS_SECTIONS[focus])
      : tab === 'upcoming'
        ? upcomingSections
        : doneSections

  const overdueTasks = useMemo(
    () =>
      todaySections
        .filter((section) => section.kind === 'overdue')
        .flatMap((section) => section.rows.map((row) => row.task))
        .filter((task): task is TaskRecord => Boolean(task)),
    [todaySections],
  )

  const focusQueue = useMemo(
    () => todaySections.flatMap((section) => section.rows).filter((row) => row.task),
    [todaySections],
  )

  function completeRow(row: StreamRowModel) {
    if (!row.task) return
    completion.complete(row.task, {
      contact: row.contact,
      stats: row.stats,
      queued: data.tasks.filter((t) => t.status === 'queued' && t.contact_id === row.contactId),
    })
  }

  function snoozeRow(row: StreamRowModel, days: number) {
    const task = row.task
    if (!task) return
    void withUndo({
      message: `Snoozed: ${task.title}`,
      perform: () =>
        updateTask.mutateAsync({
          id: task.id,
          contactId: task.contact_id,
          patch: { due_on: snoozedDueOn(days) },
        }),
      undo: async () => {
        await updateTask.mutateAsync({
          id: task.id,
          contactId: task.contact_id,
          patch: { due_on: task.due_on },
        })
      },
    })
  }

  function rescheduleAll(mode: 'today' | 'week') {
    const changes = rescheduleAllPlan(overdueTasks, mode)
    if (changes.length === 0) return
    const before = overdueTasks.map((task) => ({ id: task.id, due_on: task.due_on ?? '' }))
    void withUndo({
      message:
        mode === 'today'
          ? `${changes.length} overdue moved to today`
          : `${changes.length} overdue spread over this week`,
      perform: () => reschedule.mutateAsync(changes),
      undo: () => reschedule.mutateAsync(before),
    })
  }

  const loading = board.isLoading && !board.data
  const rewardState = tab === 'today' && !loading && todaySections.length === 0

  return (
    <>
      <PageHeader
        title="Today"
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{formatDayHeading(new Date())}</span>
            <span className="text-faint">·</span>
            <span className="tabular font-semibold">{metrics.dueToday} due</span>
            <span className="text-faint">·</span>
            <span className="tabular font-semibold text-flag-overdue">{metrics.overdue} overdue</span>
            <span className="text-faint">·</span>
            <span>
              {metrics.meetings} meeting{metrics.meetings === 1 ? '' : 's'}
            </span>
          </span>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setScopeOverride(scope === 'mine' ? 'everyone' : 'mine')}
              className="rounded-pill border border-border px-[10px] py-[3px] text-[12px] text-muted hover:text-ink"
            >
              {scope === 'mine' ? 'Mine' : 'Everyone'}
            </button>
            <Link
              to="/tasks"
              className="rounded-input border border-border bg-surface px-[14px] py-2 text-[13px] font-semibold text-nav hover:border-faint"
            >
              All tasks
            </Link>
          </div>
        }
      />

      <div className="flex flex-col gap-4 lg:flex-row lg:gap-5">
        <div className="flex min-w-0 grow flex-col gap-[14px]">
          <MetricStrip
            metrics={metrics}
            monthGiving={canSeeAmounts ? (monthGiving.data?.total ?? 0) : null}
            focus={focus}
            onFocus={setFocus}
            loading={loading}
          />

          {data.statsError ? (
            <p className="rounded-card border border-border bg-[#FCF0E3] px-[14px] py-2 text-[12.5px] text-flag-today-ink">
              Derived numbers are unavailable right now (contact_stats): {data.statsError}. Tasks and
              meetings still show; days-since and the yellow section will fill in once the view is
              readable.
            </p>
          ) : null}

          <Tabs
            aria-label="Action stream"
            active={tab}
            onChange={(next) => setTab(next as StreamTab)}
            items={[
              { id: 'today', label: 'Today' },
              { id: 'upcoming', label: 'Upcoming' },
              { id: 'done', label: `Done${metrics.doneToday > 0 ? ` · ${metrics.doneToday}` : ''}` },
            ]}
            trailing={
              focusQueue.length > 0 && !readOnly ? (
                <button
                  type="button"
                  onClick={() => setFocusMode(true)}
                  className="px-1 text-[13px] font-semibold text-accent hover:text-accent-dark"
                >
                  ▶ Start my day
                </button>
              ) : null
            }
          />

          {focus !== 'all' ? (
            <button
              type="button"
              onClick={() => setFocus('all')}
              className="self-start text-[12.5px] font-semibold text-accent hover:text-accent-dark"
            >
              Filtered by the {focus} card — show everything
            </button>
          ) : null}

          {loading ? <StreamSkeleton /> : null}

          {rewardState ? (
            <RewardState
              action={
                <Button variant="outline" onClick={() => setTab('upcoming')}>
                  See what&rsquo;s coming
                </Button>
              }
            />
          ) : null}

          {!loading && !rewardState && sections.length === 0 ? (
            <p className="rounded-card border border-dashed border-border bg-surface px-[14px] py-8 text-center text-[13px] text-muted">
              {tab === 'upcoming'
                ? 'Nothing scheduled ahead. Anything you add with a future date lands here.'
                : 'Nothing completed yet today.'}
            </p>
          ) : null}

          {sections.map((section) => (
            <section key={section.id} className="flex flex-col gap-2">
              <SectionLabel
                tone={section.tone}
                action={
                  section.kind === 'overdue' && !readOnly ? (
                    <Menu
                      label="Reschedule all overdue"
                      trigger="Reschedule all ▾"
                      triggerClassName="min-h-[26px] border-none px-0 py-0 text-[12px] font-semibold text-accent"
                      items={[
                        { id: 'today', label: 'Move all to today', onSelect: () => rescheduleAll('today') },
                        {
                          id: 'week',
                          label: 'Spread over this week',
                          onSelect: () => rescheduleAll('week'),
                        },
                      ]}
                    />
                  ) : undefined
                }
              >
                {section.label}
              </SectionLabel>

              {section.rows.map((row) => (
                <StreamRow
                  key={row.id}
                  row={row}
                  stageLabels={stageLabels}
                  dashed={section.dashed}
                  onComplete={section.kind === 'done' || readOnly ? undefined : completeRow}
                  onSnooze={section.kind === 'done' || readOnly ? undefined : snoozeRow}
                  trailing={
                    section.kind === 'needs-action' && !readOnly ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setTaskFor({ id: row.contactId, name: row.name })}
                      >
                        ＋ Next action
                      </Button>
                    ) : section.kind === 'meetings' ? (
                      <Button
                        variant="accentOutline"
                        size="sm"
                        disabled
                        title="Brief me is a phase-2 AI feature (04 §5.8)"
                      >
                        Brief me
                      </Button>
                    ) : undefined
                  }
                />
              ))}
            </section>
          ))}

          {/* Mobile: the rail folds into the stream as cards (04 §1). */}
          <NudgeRail
            className="lg:hidden"
            canSeeAmounts={canSeeAmounts}
            onCreateTask={(id, name, actionType) => setTaskFor({ id, name, actionType })}
          />
        </div>

        <NudgeRail
          className="hidden w-[300px] shrink-0 lg:flex"
          canSeeAmounts={canSeeAmounts}
          onCreateTask={(id, name, actionType) => setTaskFor({ id, name, actionType })}
        />
      </div>

      <TaskSheet
        open={taskFor !== null}
        onClose={() => setTaskFor(null)}
        contactId={taskFor?.id}
        contactName={taskFor?.name}
        initial={taskFor?.actionType ? { action_type: taskFor.actionType } : undefined}
        onCreated={(title) => toast.push(`Task added: ${title}`, { tone: 'good' })}
      />

      {focusMode ? (
        <FocusMode
          rows={focusQueue}
          stageLabels={stageLabels}
          onComplete={completeRow}
          onSnooze={snoozeRow}
          onClose={() => setFocusMode(false)}
        />
      ) : null}
    </>
  )
}

function StreamSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true" data-testid="stream-skeleton">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className={cn('h-[58px] animate-pulse rounded-card border border-border bg-surface', i > 2 && 'opacity-60')}
        />
      ))}
    </div>
  )
}
