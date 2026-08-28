import { useEffect, useMemo, useReducer, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../components'
import { isConfigured } from '../../lib/env'
import { ik } from '../../lib/queries/importKeys'
import { fetchDedupeCandidates, useCommitImport, useFunds, type CommitResult } from '../../lib/queries/import'
import { DedupeStep } from './DedupeStep'
import { DoneStep } from './DoneStep'
import { DryRunStep } from './DryRunStep'
import { MappingStep } from './MappingStep'
import { PreviewStep } from './PreviewStep'
import { Stepper, stepIndex, type WizardStep } from './Stepper'
import { UploadStep } from './UploadStep'
import { findDuplicates, resolutionReducer } from './dedupe'
import { guessMapping, mappingHasGifts, mappingIsUsable } from './mapping'
import { normalisePreview } from './normalisePreview'
import { buildCommitPlan } from './plan'
import type { ColumnMapping, ParsedCsv } from './types'

export interface ImportWizardProps {
  /** Admin-only surfaces (the undo) are gated on this. */
  isAdmin: boolean
}

/**
 * The CSV import wizard (06 §5).
 *
 * State lives here and flows one way into the steps, because every stage is a
 * pure function of the stage before it: change the mapping and the preview,
 * the duplicate scan and the dry-run summary all follow. The steps themselves
 * hold no derived state at all — the one exception being the dedupe
 * resolutions, which are the user's own decisions and are reset (explicitly)
 * whenever the rows underneath them change.
 *
 * Nothing is written until Commit. The wizard is a long look before a leap.
 */
export function ImportWizard({ isAdmin }: ImportWizardProps) {
  const [step, setStep] = useState<WizardStep>('upload')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>([])
  const [createFunds, setCreateFunds] = useState<string[]>([])
  const [result, setResult] = useState<CommitResult | null>(null)

  const funds = useFunds()
  const commit = useCommitImport()

  const rows = useMemo(
    () => (parsed ? normalisePreview(parsed.rows, mapping) : []),
    [parsed, mapping],
  )

  // The candidate pool for the dedupe pass. Only fetched once the mapping is
  // settled — before that the signals would be nonsense.
  const candidates = useQuery({
    queryKey: ik.imports.candidates({ file: parsed?.filename ?? null, rows: rows.length, mapping }),
    enabled: isConfigured && rows.length > 0 && stepIndex(step) >= stepIndex('dedupe'),
    staleTime: 60_000,
    queryFn: () => fetchDedupeCandidates(rows),
  })

  const duplicates = useMemo(
    () => (candidates.data ? findDuplicates(rows, candidates.data) : []),
    [rows, candidates.data],
  )

  const [resolutions, dispatch] = useReducer(resolutionReducer, {})
  // Rows or matches changed under the decisions — start from the wizard's own
  // defaults rather than carrying stale choices onto different rows.
  useEffect(() => {
    dispatch({ type: 'reset', duplicates })
  }, [duplicates])

  const plan = useMemo(
    () => buildCommitPlan({ rows, resolutions, funds: funds.data ?? [], createFunds }),
    [rows, resolutions, funds.data, createFunds],
  )

  const usable = mappingIsUsable(mapping)
  const hasGifts = mappingHasGifts(mapping)
  const giftsWithoutFund = hasGifts && !mapping.includes('gift_fund')

  const canAdvance =
    step === 'upload'
      ? parsed !== null
      : step === 'mapping'
        ? usable
        : step === 'preview'
          ? true
          : step === 'dedupe'
            ? !candidates.isLoading
            : true

  const next = () => {
    if (step === 'upload') setStep('mapping')
    else if (step === 'mapping') setStep('preview')
    else if (step === 'preview') setStep('dedupe')
    else if (step === 'dedupe') setStep('dryrun')
  }

  const back = () => {
    if (step === 'mapping') setStep('upload')
    else if (step === 'preview') setStep('mapping')
    else if (step === 'dedupe') setStep('preview')
    else if (step === 'dryrun') setStep('dedupe')
  }

  const reset = () => {
    setParsed(null)
    setMapping([])
    setCreateFunds([])
    setResult(null)
    setStep('upload')
  }

  if (step === 'done' && result) {
    return (
      <>
        <Stepper active="done" onGoTo={() => undefined} />
        <DoneStep result={result} canUndo={isAdmin} onStartAnother={reset} />
      </>
    )
  }

  return (
    <>
      <Stepper active={step} onGoTo={(target) => setStep(target)} />

      {step === 'upload' ? (
        <UploadStep
          parsed={parsed}
          onParsed={(file) => {
            setParsed(file)
            setMapping(guessMapping(file.headers))
            setCreateFunds([])
            setStep('mapping')
          }}
        />
      ) : null}

      {step === 'mapping' && parsed ? (
        <MappingStep parsed={parsed} mapping={mapping} onChange={setMapping} />
      ) : null}

      {step === 'preview' ? <PreviewStep rows={rows} /> : null}

      {step === 'dedupe' ? (
        <DedupeStep
          rows={rows}
          duplicates={duplicates}
          resolutions={resolutions}
          loading={candidates.isLoading}
          error={candidates.error instanceof Error ? candidates.error.message : null}
          onSet={(index, action, targetId) => dispatch({ type: 'set', index, action, targetId })}
          onSetAll={(action) => dispatch({ type: 'setAll', action, duplicates })}
        />
      ) : null}

      {step === 'dryrun' && parsed ? (
        <DryRunStep
          summary={plan.summary}
          filename={parsed.filename}
          createFunds={createFunds}
          giftsWithoutFund={giftsWithoutFund}
          onToggleFund={(name) =>
            setCreateFunds((current) =>
              current.includes(name) ? current.filter((n) => n !== name) : [...current, name],
            )
          }
        />
      ) : null}

      {commit.error ? (
        <p role="alert" className="mt-3 rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {commit.error.message}
        </p>
      ) : null}

      <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
        {step !== 'upload' ? (
          <Button variant="outline" onClick={back}>
            Back
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {step === 'dryrun' ? (
            <>
              <span className="text-[12px] text-muted">
                {plan.summary.contacts + plan.summary.merged + plan.summary.gifts === 0
                  ? 'Nothing to write.'
                  : 'This writes to the live database.'}
              </span>
              <Button
                disabled={
                  commit.isPending ||
                  !parsed ||
                  plan.summary.contacts + plan.summary.merged + plan.summary.gifts === 0
                }
                data-testid="import-commit"
                onClick={() => {
                  if (!parsed) return
                  commit.mutate(
                    {
                      rows,
                      resolutions,
                      funds: funds.data ?? [],
                      filename: parsed.filename,
                      createFunds,
                    },
                    {
                      onSuccess: (outcome) => {
                        setResult(outcome)
                        setStep('done')
                      },
                    },
                  )
                }}
              >
                {commit.isPending ? 'Importing…' : 'Import'}
              </Button>
            </>
          ) : (
            <Button disabled={!canAdvance} onClick={next} data-testid="import-next">
              Next
            </Button>
          )}
        </div>
      </div>
    </>
  )
}
