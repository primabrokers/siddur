import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { EmptyState, useToast, useUndoToast } from '../../components'
import { toISODate } from '../../lib/dates'
import { useAutomationRules, readOrgDetails } from '../../lib/queries/settings'
import {
  useBackClaimViewId,
  useCancelDeclaration,
  useClaimLines,
  useClaimValidation,
  useConfirmOralDeclaration,
  useCreateDeclaration,
  useDeleteDeclaration,
  useFixDonorAddress,
  useGiftAidBoard,
  useMarkClaimPaid,
  useSetGiftExcluded,
  useSubmitClaim,
  useUnconfirmOralDeclaration,
  useUncancelDeclaration,
  useUnmarkClaimPaid,
} from '../../lib/queries/giftaid'
import { useTeamMember } from '../auth/useTeamMember'
import { displayName } from '../contacts/normalise'
import { downloadCsv } from '../giving/download'
import { PageHeader } from '../shell/PageHeader'
import { BackClaimCard } from './BackClaimCard'
import { ClaimHistoryTable } from './ClaimHistoryTable'
import { DeclarationSheet } from './DeclarationSheet'
import { MissingDeclarationsPanel } from './MissingDeclarationsPanel'
import { RecentDeclarationsTable } from './RecentDeclarationsTable'
import { RequestDraftSheet } from './RequestDraftSheet'
import { ReviewExportSheet } from './ReviewExportSheet'
import { RollingClaimCard } from './RollingClaimCard'
import { missingQueue, summariseValidation, validationChip, type MissingQueueRow } from './logic'
import { EMPTY_BOARD, type ClaimLine, type ClaimTotalsRow, type DeclarationDraft, type DeclarationRow } from './types'

/** `XR••••` — the wireframe masks the reference in the page header. */
function maskReference(reference: string): string {
  const value = reference.trim()
  if (value === '') return 'not set'
  return `${value.slice(0, 2)}${'•'.repeat(Math.max(value.length - 2, 2))}`
}

/**
 * The Gift Aid workspace (05 §5, artboard A7) — the "+25%" screen.
 *
 * Three panels and one flow: the rolling claim that every eligible gift joins
 * by itself, the found-money queue that turns undeclared giving into
 * declarations, and the history of what has been filed. The Review & export
 * flow is the quarter's one deliberate act (07 §8) and lives behind a desktop,
 * admin-only door.
 *
 * Every figure on this screen is read from the database (`gift_aid_claim_totals`,
 * `ga_missing_declarations`, `ga_claim_validation`) — none is computed here
 * (I-8/I-9). What *is* computed here is the CSV, because its exact bytes are
 * this app's responsibility to get right.
 */
export function GiftAidView() {
  const board = useGiftAidBoard()
  const member = useTeamMember()
  const rules = useAutomationRules()
  const backClaimView = useBackClaimViewId()
  const toast = useToast()
  const withUndo = useUndoToast()

  const createDeclaration = useCreateDeclaration()
  const deleteDeclaration = useDeleteDeclaration()
  const cancelDeclaration = useCancelDeclaration()
  const uncancelDeclaration = useUncancelDeclaration()
  const confirmOral = useConfirmOralDeclaration()
  const unconfirmOral = useUnconfirmOralDeclaration()
  const fixAddress = useFixDonorAddress()
  const setExcluded = useSetGiftExcluded()
  const submitClaim = useSubmitClaim()
  const markPaid = useMarkClaimPaid()
  const unmarkPaid = useUnmarkClaimPaid()

  const [reviewOpen, setReviewOpen] = useState(false)
  const [declarationFor, setDeclarationFor] = useState<{ id?: string; name?: string } | null>(null)
  const [requestFor, setRequestFor] = useState<MissingQueueRow | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [desktop, setDesktop] = useState(true)

  // Measured, not guessed: the same 1024px breakpoint the shell uses (03 §1).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(min-width: 1024px)')
    const apply = () => setDesktop(query.matches)
    apply()
    query.addEventListener?.('change', apply)
    return () => query.removeEventListener?.('change', apply)
  }, [])

  const data = board.data ?? EMPTY_BOARD
  const role = member.data?.role ?? null
  const isAdmin = role === 'admin'
  const canChase = role === 'admin' || role === 'fundraiser'
  const org = readOrgDetails(rules.data)

  const claimId = data.rolling?.claim_id ?? null
  const validation = useClaimValidation(claimId)
  const lines = useClaimLines(reviewOpen ? claimId : null)

  const queue = useMemo(() => missingQueue(data.missing, data.contacts), [data.missing, data.contacts])
  const validationSummary = useMemo(() => summariseValidation(validation.data ?? []), [validation.data])
  const excludedLines: ClaimLine[] = useMemo(
    () => data.excluded.map((gift) => ({ gift, contact: data.contacts[gift.contact_id] ?? null })),
    [data.excluded, data.contacts],
  )

  /* ------------------------------------------------------------- verbs */

  function tookOrally(row: MissingQueueRow) {
    const name = displayName(row.contact) || 'this donor'
    void withUndo({
      message: `Oral declaration recorded for ${name} — written confirmation queued`,
      tone: 'good',
      perform: () =>
        createDeclaration.mutateAsync({
          contact_id: row.contact_id,
          declared_on: toISODate(new Date()),
          method: 'oral',
          covers_future: true,
          covers_past: true,
        }),
      undo: (result) =>
        deleteDeclaration.mutateAsync({
          id: result.declaration.id,
          contactId: row.contact_id,
          taskId: result.taskId,
        }),
    })
  }

  async function saveDeclaration(draft: DeclarationDraft) {
    setDeclarationFor(null)
    await withUndo({
      message: 'Declaration recorded',
      tone: 'good',
      perform: () =>
        createDeclaration.mutateAsync({
          contact_id: draft.contact_id,
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
          contactId: draft.contact_id,
          taskId: result.taskId,
        }),
    })
  }

  function confirmSent(declaration: DeclarationRow) {
    void withUndo({
      message: 'Written confirmation marked sent — the donor’s gifts are claimable',
      tone: 'good',
      perform: () => confirmOral.mutateAsync({ declaration }),
      undo: (result) => unconfirmOral.mutateAsync({ declaration, result }),
    })
  }

  function cancel(declaration: DeclarationRow) {
    void withUndo({
      message: 'Declaration cancelled — gifts before today stay covered',
      perform: () => cancelDeclaration.mutateAsync({ declaration }),
      undo: () => uncancelDeclaration.mutateAsync({ declaration }),
    })
  }

  function paid(claim: ClaimTotalsRow) {
    void withUndo({
      message: `Claim ${claim.hmrc_reference ?? ''} marked paid`.trim(),
      tone: 'good',
      perform: () => markPaid.mutateAsync({ claimId: claim.claim_id }),
      undo: () => unmarkPaid.mutateAsync({ claimId: claim.claim_id }),
    })
  }

  async function submit(reference: string) {
    if (!claimId) return
    setSubmitError(null)
    try {
      await submitClaim.mutateAsync({ claimId, reference })
      toast.push(`Claim filed under ${reference} — a fresh rolling claim is open`, { tone: 'good' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The claim could not be filed'
      setSubmitError(message)
      throw error
    }
  }

  /* ------------------------------------------------------------ render */

  if (board.error) {
    return (
      <>
        <PageHeader title="Gift Aid" />
        <p role="alert" className="rounded-card bg-[#FBECEC] px-4 py-3 text-[13px] text-flag-overdue">
          The Gift Aid workspace could not be read:{' '}
          {board.error instanceof Error ? board.error.message : 'unknown error'}
        </p>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Gift Aid"
        subtitle={
          <>
            HMRC ref: {maskReference(org.hmrc_reference)} · claims via Charities Online
            {!isAdmin ? ' · submitting is an admin action' : ''}
          </>
        }
        actions={
          <Link to="/giving" className="text-[13px] font-semibold text-accent hover:text-accent-dark">
            ← Giving
          </Link>
        }
      />

      {data.amountsHidden ? (
        <p className="mb-3 rounded-input bg-row px-3 py-2 text-[12.5px] text-muted">
          Amounts are hidden for your role — the claim's shape is shown without them (11 §2).
        </p>
      ) : null}

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        {/* Left: the rolling claim + what has already been filed. */}
        <div className="flex min-w-0 flex-col gap-4 xl:w-[560px] xl:shrink-0">
          <RollingClaimCard
            claim={data.rolling}
            loading={board.isLoading && !board.data}
            amountsHidden={data.amountsHidden}
            canReview={isAdmin && desktop}
            validation={validation.isLoading ? null : validationChip(validationSummary)}
            validationBlocking={!validationSummary.ready}
            onReview={() => setReviewOpen(true)}
          />

          {isAdmin && !desktop ? (
            <p className="rounded-card border border-border bg-surface px-4 py-3 text-[12.5px] text-muted">
              Reviewing and filing a claim is desktop work (03 §7) — the validation list and the HMRC schedule need the
              width. Everything else on this screen works here.
            </p>
          ) : null}

          <ClaimHistoryTable
            claims={data.history}
            canMarkPaid={isAdmin}
            onMarkPaid={paid}
            amountsHidden={data.amountsHidden}
          />

          <BackClaimCard
            recoverable4y={queue.recoverable4y}
            eligible4y={queue.eligible4y}
            donorCount={queue.donorCount}
            viewId={backClaimView.data ?? null}
            amountsHidden={data.amountsHidden}
          />
        </div>

        {/* Right: the declaration work. */}
        <div className="flex min-w-0 grow flex-col gap-4">
          <MissingDeclarationsPanel
            summary={queue}
            canChase={canChase}
            onDraftRequest={setRequestFor}
            onTookOrally={tookOrally}
            amountsHidden={data.amountsHidden}
            loading={board.isLoading && !board.data}
          />

          <RecentDeclarationsTable
            declarations={data.declarations}
            contacts={data.contacts}
            canEdit={canChase}
            onConfirm={confirmSent}
            onCancel={cancel}
            onNew={() => setDeclarationFor({})}
          />
        </div>
      </div>

      {!board.isLoading && !data.rolling && data.history.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No claim is building yet"
            hint="The rolling claim opens with the first eligible gift — a sterling gift from an individual with a declaration on file (02 §3.7)."
          />
        </div>
      ) : null}

      <ReviewExportSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        claim={data.rolling}
        lines={lines.data ?? []}
        failures={validation.data ?? []}
        loading={validation.isLoading || lines.isLoading}
        excluded={excludedLines}
        amountsHidden={data.amountsHidden}
        onFixAddress={(input) => fixAddress.mutateAsync(input)}
        onSetExcluded={async (input) => {
          await setExcluded.mutateAsync(input)
          toast.push(input.excluded ? 'Gift held back from this claim' : 'Gift back on the claim')
        }}
        onDownload={downloadCsv}
        onSubmit={submit}
        submitting={submitClaim.isPending}
        submitError={submitError}
      />

      <DeclarationSheet
        open={declarationFor !== null}
        onClose={() => setDeclarationFor(null)}
        contactId={declarationFor?.id}
        contactName={declarationFor?.name}
        onSave={saveDeclaration}
        pending={createDeclaration.isPending}
      />

      <RequestDraftSheet
        open={requestFor !== null}
        onClose={() => setRequestFor(null)}
        contact={requestFor?.contact ?? null}
        donorName={displayName(requestFor?.contact) || 'there'}
        recoverable={Number(requestFor?.recoverable ?? 0)}
        charityName={org.name}
        amountsHidden={data.amountsHidden}
      />
    </>
  )
}
