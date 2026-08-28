import { useState } from 'react'
import { Button, SectionLabel, useToast } from '../../components'
import { ConfirmDialog } from '../giving/ConfirmDialog'
import { useCalendarFeed, useRegenerateIcsToken } from '../../lib/queries/journeys'

export interface CalendarFeedLineProps {
  /** The signed-in member. Nobody ever sees another member's token. */
  memberId: string | null
}

/**
 * "Calendar feed" in Settings (10 §4).
 *
 * Lives with the journeys feature because it shipped with M9b, not because it
 * is one: it is the whole client half of the ICS integration — a personal URL,
 * a copy button, and the one destructive control in it.
 *
 * Regenerating **is** the revoke: it is the only way to cut off a URL that has
 * leaked, and it silently breaks every calendar already subscribed. That makes
 * it irreversible and outward-facing, which is exactly the narrow case where
 * the spec allows a confirm dialog instead of an undo toast (I-12 / 03 §5.2).
 */
export function CalendarFeedLine({ memberId }: CalendarFeedLineProps) {
  const feed = useCalendarFeed(memberId)
  const regenerate = useRegenerateIcsToken()
  const toast = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const url = feed.data?.url ?? ''

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard?.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard is permission-gated and blocked outright in some browsers;
      // the field is selectable, so this is a nicety, never the only route.
      toast.push('Could not copy — select the address and copy it by hand', { tone: 'overdue' })
    }
  }

  async function rotate() {
    if (!memberId) return
    try {
      await regenerate.mutateAsync({ memberId })
      setConfirmOpen(false)
      toast.push('New calendar address issued — re-subscribe with the new URL', { tone: 'good' })
    } catch (error) {
      toast.push(error instanceof Error ? error.message : 'Could not issue a new address', {
        tone: 'overdue',
      })
    }
  }

  return (
    <section
      className="mb-4 flex flex-col gap-2 rounded-card border border-border bg-surface p-[14px]"
      data-testid="calendar-feed"
    >
      <SectionLabel as="h2">Calendar feed</SectionLabel>
      <p className="max-w-[620px] text-[12.5px] leading-[1.5] text-muted">
        Your scheduled meetings, read-only, in Google Calendar or Outlook: add a calendar
        “From URL” and paste the address below. It updates on your calendar’s own refresh schedule
        — nothing is written back, and nothing is ever sent to a donor.
      </p>

      {feed.isLoading ? (
        <div className="h-[38px] animate-pulse rounded-input bg-row" />
      ) : url === '' ? (
        <p className="text-[12.5px] text-muted">
          Sign in as a team member to see your personal calendar address.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            readOnly
            value={url}
            aria-label="Your calendar feed address"
            data-testid="calendar-feed-url"
            onFocus={(event) => event.target.select()}
            className="min-w-[260px] grow rounded-input border border-border bg-row px-[10px] py-[7px] font-mono text-[12px] text-nav"
          />
          <Button variant="outline" size="sm" onClick={() => void copy()} data-testid="calendar-feed-copy">
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            data-testid="calendar-feed-regenerate"
          >
            Regenerate
          </Button>
        </div>
      )}

      <p className="text-[11.5px] text-faint">
        Treat the address like a password: anyone holding it can read your meeting times.
      </p>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void rotate()}
        title="Issue a new calendar address?"
        confirmLabel="Regenerate"
        pending={regenerate.isPending}
      >
        <p>
          The current address stops working immediately. Every calendar already subscribed to it —
          your phone, your laptop, anyone you shared it with — silently stops updating until you
          re-subscribe with the new one.
        </p>
        <p>Do this if the address has been shared or is in a place you no longer control.</p>
      </ConfirmDialog>
    </section>
  )
}
