import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Button, Sheet } from '../../components'

export interface CaptureApi {
  open: boolean
  openCapture: () => void
  closeCapture: () => void
}

const CaptureContext = createContext<CaptureApi | null>(null)

/**
 * Quick Capture is the product's single capture entry point (03 §1) — the top
 * bar button, the mobile Magic Plus and the PWA shortcut `/?capture=1` all
 * open this one sheet.
 *
 * TODO(capture): replace the placeholder body with the three-pane flow from
 * `wireframes/QuickCapture.dc.html` — free text → AI confirm chips → saved
 * (preview → confirm → write, labelled "Drafted with AI", logged to
 * `ai_activity_log`; the manual path must work with AI unavailable).
 */
export function CaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const openCapture = useCallback(() => setOpen(true), [])
  const closeCapture = useCallback(() => setOpen(false), [])

  // PWA home-screen shortcut: /?capture=1 (03 §1).
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('capture') !== '1') return
    setOpen(true)
    params.delete('capture')
    const next = params.toString()
    navigate({ pathname: location.pathname, search: next ? `?${next}` : '' }, { replace: true })
  }, [location.search, location.pathname, navigate])

  const value = useMemo<CaptureApi>(() => ({ open, openCapture, closeCapture }), [open, openCapture, closeCapture])

  return (
    <CaptureContext.Provider value={value}>
      {children}
      <QuickCaptureSheet open={open} onClose={closeCapture} />
    </CaptureContext.Provider>
  )
}

export function useCapture(): CaptureApi {
  const ctx = useContext(CaptureContext)
  if (!ctx) throw new Error('useCapture must be used inside <CaptureProvider>')
  return ctx
}

function QuickCaptureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Quick capture"
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      trailing={<span className="text-faint">Manual</span>}
      footer={
        <Button size="lg" disabled className="w-full">
          Next
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-[1.5] text-muted">
          Speak or type one line — the exact wording is kept. The next step shows editable chips for who, what
          happened and what happens next, then writes the interaction, the follow-up task and the keep-in-touch
          reset in one save.
        </p>
        <textarea
          disabled
          rows={5}
          placeholder="met dovid cohen in london this morning, very warm, strong interest in the building project…"
          className="rounded-card-lg border border-border bg-ground px-3 py-[10px] text-[15px] leading-[1.5] placeholder:text-faint focus:outline-none"
        />
        <p className="text-[11.5px] text-faint">Not wired up yet — see the TODO in `features/capture`.</p>
      </div>
    </Sheet>
  )
}
