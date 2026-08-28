import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button, Sheet, useToast } from '../../components'
import { fullName } from '../contacts/normalise'
import { useLookupOptions } from '../../lib/queries/contacts'
import {
  CaptureParseError,
  useCaptureContacts,
  useParseCapture,
  useSaveCapture,
} from '../../lib/queries/capture'
import { ConfirmPane } from './ConfirmPane'
import { InputPane } from './InputPane'
import { SavedPane } from './SavedPane'
import {
  canSave,
  captureReducer,
  initialState,
  parseAskAmount,
  resolutionOf,
  type CaptureSaved,
} from './captureState'
import {
  clearQueue,
  enqueueCapture,
  isNetworkFailure,
  readQueue,
  removeQueuedCapture,
  type QueuedCapture,
} from './offlineQueue'

/* -------------------------------------------------------------- public API */

export interface OpenCaptureOptions {
  /** Preselect a contact (the profile's Log button) — matching is skipped. */
  contactId?: string
  /** Display name for that contact, so the chip reads right immediately. */
  contactName?: string
}

/**
 * `openCapture` is passed straight to `onClick` in several places
 * (`onClick={openCapture}` in the top bar, the Magic Plus and Focus mode), so
 * the argument is widened to tolerate a click event and the options are read
 * defensively. Callers that mean it write `openCapture({ contactId })`.
 */
export type OpenCaptureArg = OpenCaptureOptions | SyntheticEvent | undefined

export interface CaptureApi {
  open: boolean
  openCapture: (options?: OpenCaptureArg) => void
  closeCapture: () => void
}

function readOpenOptions(arg: OpenCaptureArg): OpenCaptureOptions {
  if (!arg || typeof arg !== 'object') return {}
  if ('nativeEvent' in arg || 'preventDefault' in arg) return {}
  const options = arg as OpenCaptureOptions
  return {
    ...(typeof options.contactId === 'string' ? { contactId: options.contactId } : {}),
    ...(typeof options.contactName === 'string' ? { contactName: options.contactName } : {}),
  }
}

const CaptureContext = createContext<CaptureApi | null>(null)

/**
 * Quick Capture — the product's flagship (04 §4, 09 §2).
 *
 * One sheet, three panes: speak → check the chips → done, in under thirty
 * seconds. Every entry point in the app (the top-bar button, the mobile Magic
 * Plus, the PWA shortcut `/?capture=1`, a profile's Log button) opens this one
 * surface, and the AI is a convenience on top of a manual form that always
 * works (09 §1: manual paths must work when AI is unavailable).
 */
export function CaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState<OpenCaptureOptions>({})
  const location = useLocation()
  const navigate = useNavigate()

  const openCapture = useCallback((options?: OpenCaptureArg) => {
    setRequest(readOpenOptions(options))
    setOpen(true)
  }, [])
  const closeCapture = useCallback(() => setOpen(false), [])

  // PWA home-screen shortcut: /?capture=1 (03 §1).
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('capture') !== '1') return
    setRequest({})
    setOpen(true)
    params.delete('capture')
    const next = params.toString()
    navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true })
  }, [location.search, location.pathname, navigate])

  const value = useMemo<CaptureApi>(() => ({ open, openCapture, closeCapture }), [open, openCapture, closeCapture])

  return (
    <CaptureContext.Provider value={value}>
      {children}
      {open ? <QuickCaptureSheet open={open} onClose={closeCapture} request={request} /> : null}
    </CaptureContext.Provider>
  )
}

export function useCapture(): CaptureApi {
  const ctx = useContext(CaptureContext)
  if (!ctx) throw new Error('useCapture must be used inside <CaptureProvider>')
  return ctx
}

/* ------------------------------------------------------------------ sheet */

interface SheetProps {
  open: boolean
  onClose: () => void
  request: OpenCaptureOptions
}

export function QuickCaptureSheet({ open, onClose, request }: SheetProps) {
  const [state, dispatch] = useReducer(
    captureReducer,
    { contactId: request.contactId ?? null },
    (options) => initialState(options),
  )
  const [queued, setQueued] = useState<QueuedCapture[]>(() => readQueue())
  const toast = useToast()
  const navigate = useNavigate()

  const roster = useCaptureContacts()
  const kinds = useLookupOptions('interaction_kind')
  const actionTypes = useLookupOptions('action_type')
  const parse = useParseCapture()
  const save = useSaveCapture()

  // Re-arm the sheet whenever it is opened for a (possibly different) contact.
  const opened = useRef(false)
  useEffect(() => {
    if (!open) {
      opened.current = false
      return
    }
    if (opened.current) return
    opened.current = true
    dispatch({ type: 'open', contactId: request.contactId ?? null })
    setQueued(readQueue())
  }, [open, request.contactId])

  const today = useMemo(() => new Date(), [])

  const presetContact = useMemo(() => {
    if (!state.presetContactId) return null
    return (roster.data ?? []).find((contact) => contact.id === state.presetContactId) ?? null
  }, [roster.data, state.presetContactId])
  const presetName = request.contactName ?? (presetContact ? fullName(presetContact) : '')

  /* ------------------------------------------------------------ actions */

  async function runParse() {
    if (state.text.trim() === '') return
    dispatch({ type: 'parse-start' })
    try {
      const parsed = await parse.mutateAsync({
        text: state.text,
        today,
        roster: roster.data ?? [],
      })
      dispatch({
        type: 'parse-ok',
        parsed,
        today,
        roster: roster.data ?? [],
        contactName: presetName,
      })
    } catch (caught) {
      // Never a dead end: the manual form opens with the dictation intact.
      const failure = caught instanceof CaptureParseError ? caught.failure : 'error'
      dispatch({ type: 'parse-fail', failure })
    }
  }

  async function runSave() {
    if (!canSave(state)) return
    const { draft } = state
    const contactId =
      draft.contact.mode === 'preset' || draft.contact.mode === 'matched' ? draft.contact.contactId : null

    try {
      const result = await save.mutateAsync({
        source: state.source,
        rawText: state.text,
        contact: { id: contactId, createName: contactId ? null : draft.contact.name.trim() },
        interaction: {
          kind: draft.kind,
          occurredAt: draft.occurredAt,
          location: draft.location.trim() === '' ? null : draft.location.trim(),
          summary: draft.summary.trim(),
          outcome: draft.outcome.trim() === '' ? null : draft.outcome.trim(),
          askAmount: parseAskAmount(draft.askAmount),
          isScheduled: draft.isScheduled,
        },
        nextAction:
          draft.nextAction.enabled && draft.nextAction.title.trim() !== ''
            ? {
                type: draft.nextAction.type,
                title: draft.nextAction.title,
                dueOn: draft.nextAction.dueOn === '' ? null : draft.nextAction.dueOn,
              }
            : null,
        tags: draft.tags.filter((tag) => tag.accepted).map((tag) => tag.value),
        ...(state.source === 'ai' && state.parsed
          ? {
              ai: {
                model: state.parsed.model,
                output: state.parsed,
                resolution: resolutionOf(state),
                editedFields: state.editedFields,
                latencyMs: state.parsed.latency_ms ?? null,
                tokensIn: state.parsed.usage?.input_tokens ?? null,
                tokensOut: state.parsed.usage?.output_tokens ?? null,
              },
            }
          : {}),
      })

      const saved: CaptureSaved = {
        contactId: result.contactId,
        contactName: draft.contact.name || presetName || 'this contact',
        interactionId: result.interactionId,
        taskId: result.taskId,
        isScheduled: draft.isScheduled,
        kindLabel: kinds.data?.find((k) => k.value === draft.kind)?.label ?? 'Interaction',
        taskTitle: result.taskId ? draft.nextAction.title.trim() : null,
        taskDueOn: draft.nextAction.dueOn === '' ? null : draft.nextAction.dueOn,
        dateLabel: draft.nextAction.resolution?.label ?? null,
        tagCount: result.tagCount,
        queued: false,
      }
      dispatch({ type: 'saved', saved })
    } catch (caught) {
      // Signal, not permission: only network failures go to the queue (11 §6).
      if (isNetworkFailure(caught)) {
        setQueued(enqueueCapture({ text: state.text, contactId }))
        dispatch({
          type: 'saved',
          saved: {
            contactId: contactId ?? '',
            contactName: draft.contact.name || presetName || 'this contact',
            interactionId: null,
            taskId: null,
            isScheduled: draft.isScheduled,
            kindLabel: '',
            taskTitle: null,
            taskDueOn: null,
            dateLabel: null,
            tagCount: 0,
            queued: true,
          },
        })
        return
      }
      dispatch({
        type: 'save-error',
        message: caught instanceof Error ? caught.message : 'Could not save that.',
      })
    }
  }

  function retryQueued() {
    const first = queued[0]
    if (!first) return
    setQueued(removeQueuedCapture(first.id))
    dispatch({ type: 'open', contactId: first.contactId })
    dispatch({ type: 'set-text', value: first.text })
  }

  function discardQueued() {
    setQueued(clearQueue())
    toast.push('Queued captures discarded')
  }

  /* -------------------------------------------------------------- render */

  const busy = state.parsing || parse.isPending
  const saving = save.isPending

  const header = {
    input: 'Quick capture',
    confirm: state.source === 'ai' ? 'Check & save' : 'Log by hand',
    saved: 'Done',
  }[state.pane]

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={header}
      leading={
        state.pane === 'confirm' && state.text.trim() !== '' ? (
          <button type="button" onClick={() => dispatch({ type: 'back' })} className="text-muted hover:text-ink">
            Back
          </button>
        ) : state.pane === 'input' ? (
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            Cancel
          </button>
        ) : null
      }
      trailing={
        state.pane === 'input' ? (
          <button
            type="button"
            onClick={() => dispatch({ type: 'go-manual' })}
            className="text-[13px] text-muted hover:text-ink"
          >
            Manual form
          </button>
        ) : (
          <span />
        )
      }
      footer={
        state.pane === 'saved' ? null : state.pane === 'input' ? (
          <Button
            size="lg"
            className="w-full"
            disabled={state.text.trim() === '' || busy}
            onClick={() => void runParse()}
          >
            {busy ? 'Reading…' : 'Next'}
          </Button>
        ) : (
          <Button size="lg" className="w-full" disabled={!canSave(state) || saving} onClick={() => void runSave()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        )
      }
    >
      {state.pane === 'input' ? (
        <InputPane
          text={state.text}
          onTextChange={(value) => dispatch({ type: 'set-text', value })}
          parsing={busy}
          queued={queued}
          onRetryQueued={retryQueued}
          onDiscardQueued={discardQueued}
        />
      ) : null}

      {state.pane === 'confirm' ? (
        <ConfirmPane
          state={state}
          dispatch={dispatch}
          kinds={kinds.data ?? []}
          actionTypes={actionTypes.data ?? []}
          today={today}
          presetName={presetName}
        />
      ) : null}

      {state.pane === 'saved' && state.saved ? (
        <SavedPane
          saved={state.saved}
          onAddAnother={() => dispatch({ type: 'add-another' })}
          onDone={() => {
            onClose()
            if (!state.presetContactId) navigate('/')
          }}
          doneLabel={state.presetContactId ? 'Done' : 'Back to Today'}
        />
      ) : null}
    </Sheet>
  )
}
