/**
 * The poor-signal queue (11 §6 — "leaving a meeting in a basement simcha hall").
 *
 * Scope, deliberately small for M3: when the *write* fails for network reasons
 * the dictation is stashed in `localStorage` and the sheet shows
 * "1 capture waiting to sync" with a retry on its next open. Nothing is lost,
 * and the user is told.
 *
 * TODO(11 §6): upgrade the store to IndexedDB so a capture can carry the whole
 * confirmed draft (chips, resolved date, accepted tags) rather than just the
 * raw text, survive a quota-constrained localStorage, and be replayed by the
 * service worker in the background. The read/write surface below is the
 * intended seam: swap the four functions for async equivalents and the sheet
 * only has to await them.
 */

const KEY = 'crm.capture.queue.v1'

export interface QueuedCapture {
  id: string
  /** The dictation, verbatim — the whole point of the queue. */
  text: string
  contactId: string | null
  queuedAt: string
}

const store = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Safari private mode throws on access.
    return null
  }
}

export function readQueue(): QueuedCapture[] {
  const ls = store()
  if (!ls) return []
  try {
    const raw = ls.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is QueuedCapture =>
        Boolean(entry) && typeof entry.id === 'string' && typeof entry.text === 'string',
    )
  } catch {
    return []
  }
}

function write(entries: QueuedCapture[]): QueuedCapture[] {
  const ls = store()
  if (!ls) return entries
  try {
    ls.setItem(KEY, JSON.stringify(entries))
  } catch {
    // Out of quota: the in-memory copy is still returned so the UI stays honest.
  }
  return entries
}

export function enqueueCapture(input: { text: string; contactId?: string | null }): QueuedCapture[] {
  const entry: QueuedCapture = {
    id: `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text: input.text,
    contactId: input.contactId ?? null,
    queuedAt: new Date().toISOString(),
  }
  return write([...readQueue(), entry])
}

export function removeQueuedCapture(id: string): QueuedCapture[] {
  return write(readQueue().filter((entry) => entry.id !== id))
}

export function clearQueue(): QueuedCapture[] {
  return write([])
}

/**
 * Is this failure the network rather than the database saying no?
 *
 * A rejected write (RLS, a constraint) must NOT be queued — retrying it
 * forever would hide a real error. Only fetch-level failures qualify.
 */
export function isNetworkFailure(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase()
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('load failed') ||
    message.includes('fetch failed') ||
    message.includes('err_internet_disconnected') ||
    message.includes('timed out') ||
    message.includes('timeout')
  )
}

/** "1 capture waiting to sync" / "3 captures waiting to sync". */
export function queueNotice(count: number): string {
  if (count <= 0) return ''
  return `${count} capture${count === 1 ? '' : 's'} waiting to sync`
}
