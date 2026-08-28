import { useCallback, useMemo, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router'
import { Button, EmptyState, FilterChip, useToast, useUndoToast } from '../../components'
import { formatMoney } from '../../lib/format'
import { toISODate } from '../../lib/dates'
import { useLookupOptions } from '../../lib/queries/contacts'
import { useAutomationRules } from '../../lib/queries/settings'
import {
  useCreateNextMove,
  useDeleteNextMove,
  useDeleteOpportunity,
  usePipelineBoard,
  useSaveOpportunity,
  useUpdateOpportunity,
} from '../../lib/queries/pipeline'
import { useTeamMember } from '../auth/useTeamMember'
import { PageHeader } from '../shell/PageHeader'
import { LostDialog } from './LostDialog'
import { NextMoveDialog, type NextMoveDraft } from './NextMoveDialog'
import { OpportunityCard } from './OpportunityCard'
import { OpportunitySheet } from './OpportunitySheet'
import { OutcomeZones, type OutcomeZone } from './OutcomeZones'
import { StageColumn } from './StageColumn'
import { StalePanel } from './StalePanel'
import {
  buildCards,
  filterByScope,
  groupByStage,
  movePatch,
  pipelineTotals,
  revertMovePatch,
  revertStatusPatch,
  staleCards,
  staleDaysFrom,
  statusPatch,
  stageOf,
  toStages,
  type PipelineCard,
  type PortfolioScope,
} from './logic'
import { EMPTY_PIPELINE, type OpportunityDraft, type OpportunityRow } from './types'

/** The zones' outcome → the sentence the undo toast shows. */
const OUTCOME_MESSAGE: Record<OutcomeZone, string> = {
  won: 'Marked won',
  lost: 'Recorded as lost',
  on_hold: 'Put on hold',
}

/**
 * The Pipeline board (06 §2 · artboard A5) — active asks as moves through
 * stages, with the board itself saying which ask to push today.
 *
 * What the board is opinionated about, and why:
 * - cards sort by **next-activity urgency**, not by value (▸ Pipedrive). The
 *   £80k legacy with a date next month sits below the £12k ask that needed a
 *   call yesterday, and an ask with *no* next move sorts above both in yellow.
 * - **rotting** is ambient: a card idle past its stage's threshold shades pink
 *   and says so. No badge, no notification, nothing to dismiss.
 * - the **stale panel** is a list, never a rule (▸ MarketSmart, adapted).
 *
 * Drag and drop is hand-rolled HTML5 (no library, per CLAUDE.md's fixed stack).
 * Every move is optimistic with a 6-second undo (I-12); the stage select in the
 * edit sheet is the same write for anyone not using a pointer.
 */
export function PipelineView() {
  const board = usePipelineBoard()
  const stageOptions = useLookupOptions('opportunity_stage')
  const lostReasons = useLookupOptions('opportunity_lost_reason')
  const rules = useAutomationRules()
  const member = useTeamMember()
  const navigate = useNavigate()
  const toast = useToast()
  const withUndo = useUndoToast()

  const update = useUpdateOpportunity()
  const save = useSaveOpportunity()
  const remove = useDeleteOpportunity()
  const createNextMove = useCreateNextMove()
  const deleteNextMove = useDeleteNextMove()

  const [scope, setScope] = useState<PortfolioScope>('mine')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<string | null>(null)
  const [overZone, setOverZone] = useState<OutcomeZone | null>(null)
  const [sheet, setSheet] = useState<{ open: boolean; opportunity: OpportunityRow | null }>({
    open: false,
    opportunity: null,
  })
  const [lost, setLost] = useState<PipelineCard | null>(null)
  const [won, setWon] = useState<PipelineCard | null>(null)
  const [nextMove, setNextMove] = useState<{ card: PipelineCard; stageLabel: string } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const data = board.data ?? EMPTY_PIPELINE
  const readOnly = member.data?.role === 'viewer'

  const stages = useMemo(() => toStages(stageOptions.data), [stageOptions.data])
  const allCards = useMemo(() => buildCards(data, stages), [data, stages])
  const cards = useMemo(
    () => filterByScope(allCards, scope, member.data?.id),
    [allCards, scope, member.data?.id],
  )

  const openCards = useMemo(
    () => cards.filter((card) => card.opportunity.status === 'open'),
    [cards],
  )
  const columns = useMemo(() => groupByStage(openCards, stages), [openCards, stages])
  const totals = useMemo(() => pipelineTotals(openCards), [openCards])

  const staleRule = (rules.data ?? []).find((rule) => rule.rule_key === 'stale_prospects')
  const staleDays = staleDaysFrom(rules.data)
  const stale = useMemo(
    () => staleCards(openCards, staleDays, staleRule?.is_enabled !== false),
    [openCards, staleDays, staleRule?.is_enabled],
  )
  const history = useMemo(
    () => cards.filter((card) => card.opportunity.status === 'won' || card.opportunity.status === 'lost'),
    [cards],
  )

  const byId = useMemo(() => {
    const index = new Map<string, PipelineCard>()
    for (const card of allCards) index.set(card.opportunity.id, card)
    return index
  }, [allCards])

  /* ------------------------------------------------------------- dragging */

  const endDrag = useCallback(() => {
    setDragId(null)
    setOverStage(null)
    setOverZone(null)
  }, [])

  function startDrag(card: PipelineCard, event: DragEvent<HTMLElement>) {
    setDragId(card.opportunity.id)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      // Firefox refuses to start a drag without payload; the id is also the
      // fallback when the React state has been cleared by a re-render.
      try {
        event.dataTransfer.setData('text/plain', card.opportunity.id)
      } catch {
        /* jsdom and some browsers expose a read-only dataTransfer */
      }
    }
  }

  const draggedCard = (event: DragEvent<HTMLElement>): PipelineCard | null => {
    const id = dragId ?? event.dataTransfer?.getData('text/plain') ?? null
    return id ? (byId.get(id) ?? null) : null
  }

  const allowDrop = (event: DragEvent<HTMLElement>) => {
    if (!dragId) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  }

  /* ---------------------------------------------------------------- moves */

  function moveToStage(card: PipelineCard, stageValue: string) {
    const patch = movePatch(card.opportunity, stageValue, stages)
    if (!patch) return
    const before = revertMovePatch(card.opportunity)
    const label = stageOf(stages, stageValue)?.label ?? stageValue

    void withUndo({
      message: `${card.donor} → ${label}`,
      perform: () =>
        update.mutateAsync({ id: card.opportunity.id, contactId: card.opportunity.contact_id, patch }),
      undo: () =>
        update.mutateAsync({
          id: card.opportunity.id,
          contactId: card.opportunity.contact_id,
          patch: before,
        }),
    })

    // A stage *advance* with nothing open next is the gap the board exists to
    // close (I-3/I-4 · 07 §9.2).
    if (patch.last_moved_forward_at && card.nextMove === null) {
      setNextMove({ card, stageLabel: label })
    }
  }

  function dropOnStage(stageValue: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const card = draggedCard(event)
    endDrag()
    if (card && !readOnly) moveToStage(card, stageValue)
  }

  /* ------------------------------------------------------------- outcomes */

  function applyOutcome(card: PipelineCard, zone: OutcomeZone, extra: Partial<OpportunityRow> = {}) {
    const patch = { ...statusPatch(zone), ...extra }
    const before = revertStatusPatch(card.opportunity)
    return withUndo({
      message: `${OUTCOME_MESSAGE[zone]} — ${card.donor}`,
      tone: zone === 'won' ? 'good' : 'neutral',
      perform: () =>
        update.mutateAsync({ id: card.opportunity.id, contactId: card.opportunity.contact_id, patch }),
      undo: () =>
        update.mutateAsync({
          id: card.opportunity.id,
          contactId: card.opportunity.contact_id,
          patch: { ...before, notes: card.opportunity.notes },
        }),
    })
  }

  function dropOnZone(zone: OutcomeZone, event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const card = draggedCard(event)
    endDrag()
    if (!card || readOnly) return

    if (zone === 'lost') {
      // The reason is required, so it is collected before anything is written.
      setLost(card)
      return
    }
    void applyOutcome(card, zone)
    if (zone === 'won') setWon(card)
  }

  function confirmLost(reason: string, note: string) {
    const card = lost
    setLost(null)
    if (!card) return
    const stamp = `Lost ${toISODate(new Date())}: ${reason.replace(/_/g, ' ')}${note ? ` — ${note}` : ''}`
    const notes = card.opportunity.notes ? `${card.opportunity.notes}\n${stamp}` : stamp
    void applyOutcome(card, 'lost', { lost_reason: reason, notes })
  }

  function recordWin(what: 'gift' | 'pledge') {
    setWon(null)
    void navigate(`/giving?new=${what}`)
  }

  /* ------------------------------------------------------------ next move */

  function saveNextMove(draft: NextMoveDraft) {
    const prompt = nextMove
    setNextMove(null)
    if (!prompt) return
    void withUndo({
      message: `Next move set — ${draft.title}`,
      tone: 'good',
      perform: () =>
        createNextMove.mutateAsync({
          opportunityId: prompt.card.opportunity.id,
          contactId: prompt.card.opportunity.contact_id,
          title: draft.title,
          actionType: draft.actionType,
          dueOn: draft.dueOn,
        }),
      undo: (task) =>
        deleteNextMove.mutateAsync({ id: task.id, contactId: prompt.card.opportunity.contact_id }),
    })
  }

  /* ---------------------------------------------------------------- sheet */

  async function saveOpportunity(draft: OpportunityDraft, id: string | null) {
    await save.mutateAsync({ id, draft })
    toast.push(id ? 'Ask updated' : 'Ask added to the pipeline', { tone: 'good' })
  }

  function deleteOpportunity(opportunity: OpportunityRow) {
    setSheet({ open: false, opportunity: null })
    void remove
      .mutateAsync({ id: opportunity.id, contactId: opportunity.contact_id })
      .then(() => toast.push('Ask deleted — its tasks stayed with the donor', { tone: 'neutral' }))
  }

  /* --------------------------------------------------------------- render */

  const dragging = dragId !== null
  const nothingInScope = openCards.length === 0 && !board.isLoading

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader
        title="Pipeline — active asks"
        subtitle={
          <span className="tabular">
            Total asked <b className="text-gold">{formatMoney(totals.ask)}</b> · Weighted{' '}
            <b className="text-gold">{formatMoney(totals.weighted)}</b> ·{' '}
            <span className="text-muted">
              {totals.open} open · {totals.needsNextMove} need{totals.needsNextMove === 1 ? 's' : ''} a
              next move
            </span>
          </span>
        }
        actions={
          <>
            <div role="group" aria-label="Portfolio" className="flex gap-1">
              <FilterChip active={scope === 'mine'} onClick={() => setScope('mine')}>
                Mine
              </FilterChip>
              <FilterChip active={scope === 'everyone'} onClick={() => setScope('everyone')}>
                Everyone
              </FilterChip>
            </div>
            {readOnly ? null : (
              <Button onClick={() => setSheet({ open: true, opportunity: null })}>New opportunity</Button>
            )}
          </>
        }
      />

      {board.error ? (
        <p role="alert" className="mb-3 rounded-card bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          The board could not be loaded: {board.error.message}
        </p>
      ) : null}

      {nothingInScope ? (
        <EmptyState
          title={scope === 'mine' ? 'No open asks are yours' : 'No open asks yet'}
          hint={
            scope === 'mine'
              ? 'Switch to Everyone to see the whole portfolio, or start an ask of your own.'
              : 'An opportunity is one ask to one donor: what you are asking for, how much, and when they will decide.'
          }
          action={
            readOnly ? undefined : (
              <Button onClick={() => setSheet({ open: true, opportunity: null })}>New opportunity</Button>
            )
          }
        />
      ) : (
        <div className="flex min-h-0 grow flex-col gap-3 lg:flex-row lg:items-start">
          <div className="flex min-w-0 grow gap-3 overflow-x-auto pb-2">
            {columns.map((column) => (
              <StageColumn
                key={column.stage.value}
                column={column}
                dragging={dragging}
                over={overStage === column.stage.value}
                onDragOver={(event) => {
                  allowDrop(event)
                  if (dragging) setOverStage(column.stage.value)
                }}
                onDragLeave={() => setOverStage((current) => (current === column.stage.value ? null : current))}
                onDrop={(event) => dropOnStage(column.stage.value, event)}
              >
                {column.cards.map((card) => (
                  <OpportunityCard
                    key={card.opportunity.id}
                    card={card}
                    draggable={!readOnly}
                    dragging={dragId === card.opportunity.id}
                    onDragStart={(event) => startDrag(card, event)}
                    onDragEnd={endDrag}
                    onOpen={() => setSheet({ open: true, opportunity: card.opportunity })}
                  />
                ))}
              </StageColumn>
            ))}
          </div>

          <StalePanel
            stale={stale}
            days={staleDays}
            history={history}
            historyOpen={historyOpen}
            onToggleHistory={() => setHistoryOpen((value) => !value)}
            onReview={(card) => setSheet({ open: true, opportunity: card.opportunity })}
          />
        </div>
      )}

      <OutcomeZones
        visible={dragging && !readOnly}
        over={overZone}
        onDragOver={(zone, event) => {
          allowDrop(event)
          setOverZone(zone)
        }}
        onDragLeave={() => setOverZone(null)}
        onDrop={dropOnZone}
      />

      <OpportunitySheet
        open={sheet.open}
        opportunity={sheet.opportunity}
        contactName={
          sheet.opportunity ? (byId.get(sheet.opportunity.id)?.donor ?? undefined) : undefined
        }
        stages={stages}
        pending={save.isPending}
        onClose={() => setSheet({ open: false, opportunity: null })}
        onSave={saveOpportunity}
        onDelete={readOnly ? undefined : deleteOpportunity}
      />

      <LostDialog
        card={lost}
        reasons={lostReasons.data ?? []}
        pending={update.isPending}
        onClose={() => setLost(null)}
        onConfirm={confirmLost}
      />

      <WonDialog card={won} onClose={() => setWon(null)} onRecord={recordWin} />

      <NextMoveDialog
        card={nextMove?.card ?? null}
        stageLabel={nextMove?.stageLabel ?? ''}
        pending={createNextMove.isPending}
        onClose={() => setNextMove(null)}
        onSave={saveNextMove}
      />
    </div>
  )
}

/* The won prompt is imported lazily-shaped this way purely to keep the main
   component's import list readable; it is an ordinary component. */
import { WonDialog } from './WonDialog'

function WonDialogHost(props: Parameters<typeof WonDialog>[0]) {
  return <WonDialog {...props} />
}
