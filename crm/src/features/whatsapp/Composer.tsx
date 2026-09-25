import { useMemo, useState } from 'react'
import { Button, Select, TextArea, TextInput } from '../../components'
import { cn } from '../../lib/cn'
import {
  composerState,
  renderTemplatePreview,
  templatePlaceholderCount,
  windowRemainingLabel,
  WA_WINDOW_CLOSED_BANNER,
} from './core'
import type { WaTemplateRow } from './types'

export interface ComposerSend {
  body?: string
  templateName?: string
  language?: string
  params?: string[]
}

export interface ComposerProps {
  hasConversation: boolean
  lastInboundAt: string | null
  templates: WaTemplateRow[]
  onSend: (payload: ComposerSend) => void
  sending?: boolean
  error?: string | null
  /** Injectable for deterministic tests and screenshots. */
  now?: number
}

/** Only Meta-approved templates may be sent; the rest are shown in Settings. */
export const approvedTemplates = (templates: WaTemplateRow[]): WaTemplateRow[] =>
  templates.filter((template) => (template.status ?? '').toUpperCase() === 'APPROVED')

/**
 * The composer (10 §2 Tier 2 · I-10).
 *
 * Inside the 24-hour customer-service window it is a text box. Outside it, the
 * text box is **replaced** — not disabled — by the template picker, because a
 * greyed-out field invites the workaround and the workaround is the policy
 * breach. The same rule is enforced again in `wa-send`, server-side, against
 * the conversation's real `last_inbound_at`: this screen prevents the mistake,
 * the function prevents the bypass.
 */
export function Composer({
  hasConversation,
  lastInboundAt,
  templates,
  onSend,
  sending = false,
  error = null,
  now,
}: ComposerProps) {
  const approved = useMemo(() => approvedTemplates(templates), [templates])
  const state = composerState({
    hasConversation,
    lastInboundAt,
    templateCount: approved.length,
    nowMs: now ?? Date.now(),
  })

  const [text, setText] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [params, setParams] = useState<string[]>([])
  const [showTemplates, setShowTemplates] = useState(false)

  const chosen = approved.find((template) => template.name === templateName) ?? approved[0] ?? null
  const placeholders = templatePlaceholderCount(chosen?.body)
  const filled = Array.from({ length: placeholders }, (_, index) => params[index] ?? '')

  const sendTemplate = () => {
    if (!chosen) return
    onSend({ templateName: chosen.name, language: chosen.language, params: filled })
    setParams([])
  }

  const sendFree = () => {
    const body = text.trim()
    if (body === '') return
    onSend({ body })
    setText('')
  }

  if (state.mode === 'idle') return null

  const templatePanel = (
    <div className="flex flex-col gap-2">
      {approved.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface px-4 py-4 text-[12.5px] leading-[1.55] text-muted">
          <p className="font-semibold text-ink">No approved templates yet</p>
          <p className="mt-1">
            Outside the 24-hour window WhatsApp only carries templates that Meta has approved. Create and
            submit them in <strong>Meta Business Manager → WhatsApp Manager → Message templates</strong>;
            approval usually takes minutes to a day. Then press “Sync templates” in Settings and they appear
            here.
          </p>
          <p className="mt-1">
            Until then the honest options are a phone call, an email, or waiting for the donor to write
            first — which reopens the window for 24 hours.
          </p>
        </div>
      ) : (
        <>
          <label className="flex flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-muted">Approved template</span>
            <Select
              value={chosen?.name ?? ''}
              onChange={(event) => {
                setTemplateName(event.target.value)
                setParams([])
              }}
              aria-label="Approved template"
              options={approved.map((template) => ({
                value: template.name,
                label: `${template.name} · ${template.language}${
                  template.category ? ` · ${template.category.toLowerCase()}` : ''
                }`,
              }))}
            />
          </label>

          {placeholders > 0 ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: placeholders }, (_, index) => (
                <label key={index} className="flex items-center gap-2">
                  <span className="w-[42px] shrink-0 text-[12px] font-semibold text-muted">{`{{${index + 1}}}`}</span>
                  <TextInput
                    value={filled[index]}
                    aria-label={`Template parameter ${index + 1}`}
                    onChange={(event) => {
                      const next = [...filled]
                      next[index] = event.target.value
                      setParams(next)
                    }}
                  />
                </label>
              ))}
            </div>
          ) : null}

          {chosen?.body ? (
            <p className="rounded-input bg-ground px-3 py-2 text-[12.5px] leading-[1.5] text-nav">
              {renderTemplatePreview(chosen.body, filled)}
            </p>
          ) : null}

          <Button
            className="self-end"
            onClick={sendTemplate}
            disabled={sending || !chosen || filled.some((value) => value.trim() === '')}
          >
            {sending ? 'Sending…' : 'Send template'}
          </Button>
        </>
      )}
    </div>
  )

  return (
    <div className="border-t border-border bg-surface px-4 py-3">
      {state.mode === 'free_form' ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold text-good">
              Window open · {windowRemainingLabel(state.window)}
            </span>
            <button
              type="button"
              onClick={() => setShowTemplates((open) => !open)}
              className="text-[11.5px] font-semibold text-accent hover:text-accent-dark"
            >
              {showTemplates ? 'Write a message' : 'Use a template…'}
            </button>
          </div>
          {showTemplates ? (
            templatePanel
          ) : (
            <>
              <TextArea
                value={text}
                rows={2}
                aria-label="Message"
                placeholder="Write a message…"
                onChange={(event) => setText(event.target.value)}
              />
              <Button className="self-end" onClick={sendFree} disabled={sending || text.trim() === ''}>
                {sending ? 'Sending…' : 'Send'}
              </Button>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p
            role="status"
            className={cn(
              'rounded-input bg-[#FCF0E3] px-3 py-2 text-[12.5px] font-semibold text-flag-today-ink',
            )}
          >
            {WA_WINDOW_CLOSED_BANNER}
          </p>
          {templatePanel}
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-2 rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {error}
        </p>
      ) : null}
    </div>
  )
}
