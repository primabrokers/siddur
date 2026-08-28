import { useEffect, useState } from 'react'
import { queueNotice, type QueuedCapture } from './offlineQueue'

/**
 * Pane 1 — one full-screen text box, keyboard up, mic-friendly (04 §4).
 *
 * Nothing else on screen on purpose: the 20–30-second promise dies the moment
 * the user has to choose a field before speaking. The placeholder rotates real
 * examples so the shape of a good note is learnable without instructions.
 */

export const PLACEHOLDER_EXAMPLES = [
  'met dovid cohen in london this morning, very warm, strong interest in the building project, discussed twenty k, he wants me to call him after sukkos',
  'quick call with mrs frankel, she is in for the dinner, send her the sponsorship list next week',
  'meeting with katz thursday 3pm at his office re the scholarship fund',
  'bumped into r weiss at shul, he will introduce me to his brother in law, follow up before pesach',
  'whatsapp from chaim lax — he is giving 5k this year, thank him and log it',
]

const ROTATE_MS = 5000

export interface InputPaneProps {
  text: string
  onTextChange: (value: string) => void
  parsing: boolean
  queued: QueuedCapture[]
  onRetryQueued: () => void
  onDiscardQueued: () => void
}

export function InputPane({
  text,
  onTextChange,
  parsing,
  queued,
  onRetryQueued,
  onDiscardQueued,
}: InputPaneProps) {
  const [example, setExample] = useState(0)

  // Rotate only while the box is empty; a moving target under live text is noise.
  useEffect(() => {
    if (text !== '' || parsing) return
    const timer = setInterval(() => setExample((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length), ROTATE_MS)
    return () => clearInterval(timer)
  }, [text, parsing])

  return (
    <div className="flex min-h-[46vh] flex-col gap-3 lg:min-h-[320px]">
      {queued.length > 0 ? (
        <div
          data-testid="capture-queue-notice"
          className="flex flex-wrap items-center gap-2 rounded-card border border-flag-waiting bg-flag-waiting-bg px-3 py-2 text-[12.5px] text-flag-waiting"
        >
          <span className="font-semibold">{queueNotice(queued.length)}</span>
          <button type="button" onClick={onRetryQueued} className="font-semibold text-accent-dark hover:underline">
            Retry
          </button>
          <button type="button" onClick={onDiscardQueued} className="text-muted hover:text-ink">
            Discard
          </button>
        </div>
      ) : null}

      <label htmlFor="capture-text" className="sr-only">
        What happened
      </label>
      <textarea
        id="capture-text"
        autoFocus
        value={text}
        disabled={parsing}
        onChange={(event) => onTextChange(event.target.value)}
        placeholder={PLACEHOLDER_EXAMPLES[example]}
        className="min-h-[38vh] grow resize-none rounded-card-lg border-0 bg-transparent p-0 text-[17px] leading-[1.5] text-ink placeholder:text-faint focus:outline-none disabled:opacity-60 lg:min-h-[220px] lg:text-[16px]"
      />

      {parsing ? (
        <div data-testid="capture-parsing" className="flex flex-col gap-[6px]">
          <p className="text-center text-[12.5px] text-accent-dark">Reading your note…</p>
          <div className="h-[3px] w-full overflow-hidden rounded-pill bg-accent-soft">
            <div className="dc-fade-enter h-full w-1/3 animate-pulse rounded-pill bg-accent" />
          </div>
        </div>
      ) : (
        <p className="text-center text-[12.5px] text-faint">
          Dictate with the keyboard mic — the exact wording is kept
        </p>
      )}
    </div>
  )
}
