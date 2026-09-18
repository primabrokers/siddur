import { useEffect, useState } from 'react'
import { Button, Field, Sheet, TextInput, useToast } from '../../components'
import { cn } from '../../lib/cn'
import { useCreateSavedView } from '../../lib/queries/views'
import { describeFilters, type ViewFilters } from './filterModel'

/**
 * The icon vocabulary saved views draw from — one glyph per kind of queue, so
 * the sidebar reads at a glance. Stored as a name in `saved_views.icon`.
 */
export const VIEW_ICONS: Array<{ value: string; glyph: string; label: string }> = [
  { value: 'clock', glyph: '🕐', label: 'Time-based' },
  { value: 'alert', glyph: '⚠', label: 'Needs attention' },
  { value: 'trend-down', glyph: '↘', label: 'Falling away' },
  { value: 'handshake', glyph: '🤝', label: 'Promises' },
  { value: 'star', glyph: '★', label: 'Important people' },
  { value: 'gift', glyph: '🎁', label: 'Giving' },
  { value: 'map', glyph: '📍', label: 'Place or community' },
]

export interface SaveViewSheetProps {
  open: boolean
  onClose: () => void
  filters: ViewFilters
  /** Called with the new view's id, so the route can switch straight to it. */
  onSaved: (id: string) => void
}

/**
 * "Save as view" (06 §1). A view is a name, an icon and the criteria already
 * on screen — nothing else to fill in, because the criteria *are* the work.
 *
 * `is_shared` defaults on: the yeshiva is one small team working one shared
 * set of queues, and a private view is the exception worth a deliberate tap.
 */
export function SaveViewSheet({ open, onClose, filters, onSaved }: SaveViewSheetProps) {
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('clock')
  const [shared, setShared] = useState(true)
  const create = useCreateSavedView()
  const toast = useToast()

  useEffect(() => {
    if (!open) return
    setName('')
    setIcon('clock')
    setShared(true)
    create.reset()
    // `create` is a stable mutation object; re-arming on open is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const chips = describeFilters(filters)

  async function save() {
    const trimmed = name.trim()
    if (trimmed === '') return
    try {
      const view = await create.mutateAsync({ name: trimmed, filters, icon, is_shared: shared })
      toast.push(`“${view.name}” pinned`)
      onSaved(view.id)
      onClose()
    } catch {
      // The error renders in the sheet; the sheet stays open with the name kept.
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Save as view"
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={name.trim() === '' || create.isPending}
          onClick={() => void save()}
        >
          {create.isPending ? 'Saving…' : 'Save view'}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" required hint="What is this queue for? “Quiet VIPs”, “Dinner follow-ups”.">
          <TextInput
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name this view"
            autoFocus
          />
        </Field>

        <div className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">Icon</span>
          <div className="flex flex-wrap gap-[6px]">
            {VIEW_ICONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={icon === option.value}
                aria-label={option.label}
                onClick={() => setIcon(option.value)}
                className={cn(
                  'flex h-[34px] w-[34px] items-center justify-center rounded-input border text-[15px]',
                  icon === option.value
                    ? 'border-accent bg-accent-soft'
                    : 'border-border hover:border-faint',
                )}
              >
                {option.glyph}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-[10px] text-[13px]">
          <input type="checkbox" checked={shared} onChange={(event) => setShared(event.target.checked)} />
          Share with the team
        </label>

        <div className="rounded-card border border-border bg-ground p-3">
          <div className="mb-[6px] text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">
            Criteria
          </div>
          {chips.length === 0 ? (
            <p className="text-[12.5px] text-muted">Everyone — no criteria set.</p>
          ) : (
            <ul className="flex flex-wrap gap-[6px]">
              {chips.map((chip) => (
                <li
                  key={chip.key}
                  className="rounded-pill border border-chip-border px-[9px] py-[3px] text-[11.5px] text-muted"
                >
                  {chip.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        {create.error ? (
          <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
            {create.error.message}
          </p>
        ) : null}
      </div>
    </Sheet>
  )
}
