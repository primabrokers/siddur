/**
 * Recently-viewed contacts and command usage counts.
 *
 * Both are *conveniences*, not data: they live in `localStorage` on the one
 * device, never sync, and every read is defensive (private windows, cleared
 * site data and storage-blocked contexts all throw or return nothing). A
 * failure here degrades the overlay to "type to search", never breaks it.
 *
 * The recents list is what the search overlay shows *before* a keystroke
 * (03 §3: "recent-records cache serves instantly while the query runs").
 */

export const RECENTS_KEY = 'crm.search.recents'
export const USAGE_KEY = 'crm.palette.usage'
export const RECENTS_LIMIT = 8

export interface RecentContact {
  id: string
  name: string
  /** Epoch ms of the last visit — the sort key. */
  at: number
}

/* ------------------------------------------------------------- primitives */

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    const parsed: unknown = JSON.parse(raw)
    return (parsed as T) ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable or full: the feature simply stops remembering.
  }
}

/* ----------------------------------------------------------------- recents */

export function readRecents(): RecentContact[] {
  const rows = readJson<unknown>(RECENTS_KEY, [])
  if (!Array.isArray(rows)) return []
  return rows
    .filter(
      (row): row is RecentContact =>
        Boolean(row) &&
        typeof row === 'object' &&
        typeof (row as RecentContact).id === 'string' &&
        typeof (row as RecentContact).name === 'string',
    )
    .map((row) => ({ id: row.id, name: row.name, at: Number(row.at) || 0 }))
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENTS_LIMIT)
}

/** Move a contact to the front of the list, capped at eight. */
export function rememberContact(id: string, name: string, at: number = Date.now()): RecentContact[] {
  if (!id) return readRecents()
  const next = [{ id, name, at }, ...readRecents().filter((row) => row.id !== id)].slice(0, RECENTS_LIMIT)
  writeJson(RECENTS_KEY, next)
  return next
}

export function clearRecents(): void {
  try {
    window.localStorage.removeItem(RECENTS_KEY)
  } catch {
    /* nothing to clear */
  }
}

/* ------------------------------------------------------------------ usage */

export type UsageCounts = Record<string, number>

export function readUsage(): UsageCounts {
  const raw = readJson<unknown>(USAGE_KEY, {})
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: UsageCounts = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const count = Number(value)
    if (Number.isFinite(count) && count > 0) out[key] = count
  }
  return out
}

/** One more run of a palette command — the second half of context ranking. */
export function recordUsage(commandId: string): UsageCounts {
  const usage = readUsage()
  const next = { ...usage, [commandId]: (usage[commandId] ?? 0) + 1 }
  writeJson(USAGE_KEY, next)
  return next
}
