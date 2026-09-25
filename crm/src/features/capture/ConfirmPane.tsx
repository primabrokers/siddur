import { format } from 'date-fns'
import { Avatar, SectionLabel } from '../../components'
import { cn } from '../../lib/cn'
import { formatMoney, initialsOf } from '../../lib/format'
import { Chip, ChipField, DateChip, ProvenanceLine } from './CaptureChips'
import { matchSubtitle } from './contactMatch'
import { CAPTURE_FAILURE_NOTICE, LOW_CONFIDENCE } from './types'
import type { CaptureAction, CaptureDraft, CaptureState, EditableField } from './captureState'
import type { LookupOption } from '../contacts/types'

/** The white monogram circle the teal contact chip carries in the wireframe. */
function ChipAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full bg-surface text-[11.5px] font-bold text-accent-dark"
    >
      {initialsOf(name)}
    </span>
  )
}

/**
 * Pane 2 — the AI review panel (04 §4, contract in 09 §2), and the same
 * component in manual mode with the chips simply empty.
 *
 * The rules it enforces:
 *   - a contact is matched, picked or explicitly created — never invented
 *   - the date chip shows the *resolver's* answer, refusably
 *   - suggested updates are off until tapped
 *   - the only things that can block Save are the contact and the summary (I-5)
 */

export interface ConfirmPaneProps {
  state: CaptureState
  dispatch: (action: CaptureAction) => void
  kinds: LookupOption[]
  actionTypes: LookupOption[]
  today: Date
  /** Name of the preselected contact, when opened from a profile's Log button. */
  presetName: string
}

const labelFor = (options: LookupOption[], value: string, fallback: string): string =>
  options.find((option) => option.value === value)?.label ?? fallback

const titleise = (value: string): string =>
  value ? value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ') : ''

/** "Today 10:00" / "Tue 6 Oct 14:00" — the `when` chip's wording. */
function whenLabel(occurredAt: string, today: Date): string {
  const parsed = new Date(occurredAt)
  if (Number.isNaN(parsed.getTime())) return 'When?'
  const sameDay = format(parsed, 'yyyy-MM-dd') === format(today, 'yyyy-MM-dd')
  return sameDay ? `Today ${format(parsed, 'HH:mm')}` : format(parsed, 'EEE d MMM HH:mm')
}

export function ConfirmPane({ state, dispatch, kinds, actionTypes, today, presetName }: ConfirmPaneProps) {
  const { draft, source, parsed, failure } = state
  const { contact, nextAction } = draft
  const lowConfidence = source === 'ai' && parsed !== null && parsed.confidence < LOW_CONFIDENCE

  const edit = (field: EditableField, patch: Partial<CaptureDraft>) => dispatch({ type: 'edit', field, patch })

  return (
    <div className="flex flex-col gap-[14px]">
      {failure ? (
        <p
          role="status"
          data-testid="capture-failure-notice"
          className="rounded-card border border-flag-waiting bg-flag-waiting-bg px-3 py-2 text-[12.5px] leading-[1.45] text-flag-waiting"
        >
          {CAPTURE_FAILURE_NOTICE[failure]}
        </p>
      ) : null}

      {/* 09 §2: a low-confidence parse renders empty chips and shows the raw
          text, rather than filling the record with guesses. */}
      {lowConfidence ? (
        <div
          role="status"
          data-testid="capture-low-confidence"
          className="flex flex-col gap-[6px] rounded-card border border-flag-none bg-[#FDF8E3] px-3 py-2 text-[12.5px] leading-[1.45] text-flag-none-ink"
        >
          <span>Not confident enough to fill the chips — here is exactly what you said.</span>
          <span className="rounded-input bg-surface px-[10px] py-2 text-[12px] text-muted">{state.text}</span>
        </div>
      ) : null}

      {/* ------------------------------------------------------------- WHO */}
      <section className="flex flex-col gap-[6px]">
        <SectionLabel tone="faint">Who</SectionLabel>

        {contact.mode === 'preset' || contact.mode === 'matched' ? (
          <div
            data-testid="capture-contact-matched"
            className="flex items-center gap-[10px] rounded-card-lg border-[1.5px] border-accent bg-accent-soft px-[14px] py-[10px]"
          >
            <ChipAvatar name={contact.name || presetName} />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-bold">{contact.name || presetName || 'This contact'}</div>
              <div className="truncate text-[11.5px] text-accent-dark">
                {contact.mode === 'preset'
                  ? 'from their profile'
                  : (contact.candidates[0] ? matchSubtitle(contact.candidates[0]) : 'matched')}
              </div>
            </div>
            <span aria-label="confirmed" className="ml-auto font-bold text-accent-dark">
              ✓
            </span>
          </div>
        ) : null}

        {contact.mode === 'ambiguous' ? (
          <div data-testid="capture-contact-picker" className="flex flex-col gap-[6px]">
            <p className="text-[12px] text-muted">
              Which <b className="text-ink">{contact.query}</b>?
            </p>
            {contact.candidates.map((candidate) => (
              <button
                key={candidate.contact.id}
                type="button"
                onClick={() =>
                  dispatch({
                    type: 'pick-contact',
                    contactId: candidate.contact.id,
                    name: [candidate.contact.first_name, candidate.contact.last_name].filter(Boolean).join(' '),
                  })
                }
                className="flex items-center gap-[10px] rounded-card-lg border border-border bg-surface px-[14px] py-[9px] text-left hover:border-accent"
              >
                <Avatar
                  name={[candidate.contact.first_name, candidate.contact.last_name].filter(Boolean).join(' ')}
                  size="sm"
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold">
                    {[candidate.contact.first_name, candidate.contact.last_name].filter(Boolean).join(' ')}
                  </span>
                  <span className="block truncate text-[11.5px] text-muted">{matchSubtitle(candidate)}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => dispatch({ type: 'create-new-contact' })}
              className="self-start text-[12.5px] text-accent hover:underline"
            >
              None of these — create “{contact.query}”
            </button>
          </div>
        ) : null}

        {contact.mode === 'create' ? (
          <div data-testid="capture-contact-create" className="flex flex-col gap-[6px]">
            <div className="flex items-center gap-[10px] rounded-card-lg border-[1.5px] border-dashed border-accent bg-accent-soft px-[14px] py-[10px]">
              <ChipAvatar name={contact.name} />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-bold">Create new: {contact.name}?</div>
                <div className="text-[11.5px] text-accent-dark">No match in the book — saved as a new contact</div>
              </div>
            </div>
            <input
              aria-label="Name for the new contact"
              value={contact.name}
              onChange={(event) =>
                edit('contact', { contact: { ...contact, name: event.target.value } })
              }
              className="rounded-input border border-border bg-surface px-3 py-[7px] text-[13px] focus:border-accent focus:outline-none"
            />
          </div>
        ) : null}

        {contact.mode === 'none' ? (
          <div data-testid="capture-contact-none" className="flex flex-col gap-[6px]">
            <p className="text-[12px] text-muted">Who was this with? Type a name to file it.</p>
            <input
              autoFocus
              aria-label="Contact name"
              placeholder="Dovid Cohen"
              value={contact.name}
              onChange={(event) =>
                edit('contact', {
                  contact: {
                    ...contact,
                    mode: event.target.value.trim() === '' ? 'none' : 'create',
                    name: event.target.value,
                    query: event.target.value,
                  },
                })
              }
              className="rounded-input border border-border bg-surface px-3 py-[7px] text-[13px] focus:border-accent focus:outline-none"
            />
          </div>
        ) : null}
      </section>

      {/* --------------------------------------------------- WHAT HAPPENED */}
      <section className="flex flex-col gap-[6px]">
        <SectionLabel tone="faint">What happened</SectionLabel>
        <div className="flex flex-wrap items-center gap-[6px]">
          <ChipField
            name="Kind"
            strong
            label={labelFor(kinds, draft.kind, titleise(draft.kind))}
            children={(cls) => (
              <select
                aria-label="Kind"
                value={draft.kind}
                onChange={(event) => edit('kind', { kind: event.target.value })}
                className={cn(cls, 'appearance-none')}
              >
                {(kinds.length > 0
                  ? kinds
                  : [{ value: draft.kind, label: titleise(draft.kind) } as LookupOption]
                ).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
          />

          <ChipField
            name="When"
            label={whenLabel(draft.occurredAt, today)}
            children={(cls) => (
              <input
                aria-label="When"
                type="datetime-local"
                value={draft.occurredAt}
                onChange={(event) => edit('occurred_at', { occurredAt: event.target.value })}
                className={cls}
              />
            )}
          />

          <ChipField
            name="Where"
            label={draft.location === '' ? 'Add place' : draft.location}
            children={(cls) => (
              <input
                aria-label="Where"
                value={draft.location}
                placeholder="London"
                onChange={(event) => edit('location', { location: event.target.value })}
                className={cls}
              />
            )}
          />

          <ChipField
            name="Ask amount"
            money={draft.askAmount !== ''}
            label={draft.askAmount === '' ? 'Add ask' : `Ask ${formatMoney(Number(draft.askAmount))}`}
            children={(cls) => (
              <input
                aria-label="Ask amount"
                inputMode="decimal"
                value={draft.askAmount}
                placeholder="20000"
                onChange={(event) => edit('ask_amount', { askAmount: event.target.value })}
                className={cn(cls, 'tabular')}
              />
            )}
          />

          <Chip
            active={draft.isScheduled}
            onClick={() => edit('is_scheduled', { isScheduled: !draft.isScheduled })}
            aria-label="Toggle scheduled"
          >
            {draft.isScheduled ? 'Scheduled ahead' : 'Already happened'}
          </Chip>
        </div>

        <label className="sr-only" htmlFor="capture-summary">
          Summary
        </label>
        <textarea
          id="capture-summary"
          rows={3}
          value={draft.summary}
          placeholder="What happened, in a sentence"
          onChange={(event) => edit('summary', { summary: event.target.value })}
          className="rounded-card-lg border border-border bg-surface px-3 py-[10px] text-[13px] leading-[1.45] placeholder:text-faint focus:border-accent focus:outline-none"
        />

        <input
          aria-label="Outcome"
          value={draft.outcome}
          placeholder="Outcome — what it led to (optional)"
          onChange={(event) => edit('outcome', { outcome: event.target.value })}
          className="rounded-input border border-border bg-surface px-3 py-[7px] text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
        />
      </section>

      {/* ----------------------------------------------- WHAT HAPPENS NEXT */}
      <section className="flex flex-col gap-[6px]">
        <SectionLabel
          tone="faint"
          action={
            <button
              type="button"
              onClick={() =>
                edit('next_action', { nextAction: { ...nextAction, enabled: !nextAction.enabled } })
              }
              className="text-[11.5px] font-semibold text-accent hover:underline"
            >
              {nextAction.enabled ? 'Remove' : 'Add one'}
            </button>
          }
        >
          What happens next
        </SectionLabel>

        {nextAction.enabled ? (
          <>
            <div className="flex flex-wrap items-center gap-[6px]">
              <ChipField
                name="Action"
                strong
                label={labelFor(actionTypes, nextAction.type, titleise(nextAction.type))}
                children={(cls) => (
                  <select
                    aria-label="Action type"
                    value={nextAction.type}
                    onChange={(event) =>
                      edit('next_action_type', { nextAction: { ...nextAction, type: event.target.value } })
                    }
                    className={cn(cls, 'appearance-none')}
                  >
                    {(actionTypes.length > 0
                      ? actionTypes
                      : [{ value: nextAction.type, label: titleise(nextAction.type) } as LookupOption]
                    ).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              />
              <DateChip
                nextAction={nextAction}
                onDateChange={(value) =>
                  edit('next_action_due_on', {
                    nextAction: { ...nextAction, dueOn: value, resolution: null },
                  })
                }
              />
            </div>
            <input
              aria-label="Next action"
              value={nextAction.title}
              placeholder="Call re building project / £20k"
              onChange={(event) =>
                edit('next_action_title', { nextAction: { ...nextAction, title: event.target.value } })
              }
              className="rounded-input border border-border bg-surface px-3 py-[7px] text-[12.5px] placeholder:text-faint focus:border-accent focus:outline-none"
            />
            {nextAction.dueOn === '' ? (
              <p className="text-[11px] text-flag-none-ink">
                No date — it goes on the queued stack until you give it one.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[12px] text-faint">
            Nothing queued. A contact with no next action carries the yellow flag (I-3).
          </p>
        )}
      </section>

      {/* -------------------------------------------------- suggested updates */}
      {draft.tags.length > 0 ? (
        <section className="flex flex-col gap-[6px]">
          <SectionLabel tone="faint">Suggested</SectionLabel>
          <div className="flex flex-wrap items-center gap-[6px]">
            {draft.tags.map((tag) => (
              <button
                key={tag.value}
                type="button"
                aria-pressed={tag.accepted}
                onClick={() => dispatch({ type: 'toggle-tag', value: tag.value })}
                className={cn(
                  'rounded-pill px-[11px] py-[4px] text-[12.5px] transition-colors',
                  tag.accepted
                    ? 'border border-accent bg-accent-soft font-semibold text-accent-dark'
                    : 'border border-border text-muted hover:text-ink',
                )}
              >
                {tag.accepted ? '✓' : '＋'} tag “{tag.value}”{tag.accepted ? '' : '?'}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {source === 'ai' ? <ProvenanceLine rawText={state.text} /> : null}

      {source === 'manual' && state.text.trim() !== '' ? (
        <p className="text-center text-[11.5px] text-faint">Your note is kept with the record either way</p>
      ) : null}

      {state.saveError ? (
        <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {state.saveError}
        </p>
      ) : null}
    </div>
  )
}
