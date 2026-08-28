import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { qk } from '../../lib/queries/keys'
import { displayName } from '../contacts/normalise'
import type { ContactRow } from '../contacts/types'
import { CommandPalette } from './CommandPalette'
import { SearchOverlay } from './SearchOverlay'
import { rememberContact } from './recents'

export interface OmniApi {
  /** Which overlay is up, if any. */
  surface: 'search' | 'palette' | null
  openSearch: () => void
  openPalette: () => void
  close: () => void
}

const OmniContext = createContext<OmniApi | null>(null)

/** True when the keystroke belongs to whatever the user is typing into. */
function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable) return true
  return /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
}

const CONTACT_PATH = /^\/contacts\/([0-9a-zA-Z-]+)$/

/**
 * The two command surfaces (03 §3) and the keys that open them.
 *
 * Attio's split, adopted literally: **"/" is for records**, **Cmd/Ctrl+K is
 * for actions**. Both are global, both are dismissed with Escape, and either
 * key swaps straight to the other surface while one is open.
 *
 * This provider also keeps the recently-viewed list: every visit to a profile
 * pushes it to the front (localStorage, capped at eight), which is what the
 * search overlay shows before a keystroke. It is done here, from the router,
 * so no feature has to remember to call it.
 */
export function OmniProvider({ children }: { children: ReactNode }) {
  const [surface, setSurface] = useState<'search' | 'palette' | null>(null)
  const location = useLocation()
  const client = useQueryClient()

  const openSearch = useCallback(() => setSurface('search'), [])
  const openPalette = useCallback(() => setSurface('palette'), [])
  const close = useCallback(() => setSurface(null), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isPalette = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'
      if (isPalette) {
        event.preventDefault()
        setSurface((current) => (current === 'palette' ? null : 'palette'))
        return
      }
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      // "/" is a legitimate character inside a field — only claim it outside one.
      if (isTypingTarget(event.target)) return
      event.preventDefault()
      setSurface('search')
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Recently viewed. The name is a convenience only: the overlay re-reads the
  // contacts by id, so a cache miss here costs nothing but a blank fallback.
  useEffect(() => {
    const match = CONTACT_PATH.exec(location.pathname)
    const id = match?.[1]
    if (!id) return
    const cached = client.getQueryData<{ contact: ContactRow }>(qk.contacts.detail(id))
    rememberContact(id, cached?.contact ? displayName(cached.contact) : '')
  }, [location.pathname, client])

  const value = useMemo<OmniApi>(
    () => ({ surface, openSearch, openPalette, close }),
    [surface, openSearch, openPalette, close],
  )

  return (
    <OmniContext.Provider value={value}>
      {children}
      <SearchOverlay open={surface === 'search'} onClose={close} />
      <CommandPalette open={surface === 'palette'} onClose={close} />
    </OmniContext.Provider>
  )
}

export function useOmni(): OmniApi {
  const ctx = useContext(OmniContext)
  if (!ctx) throw new Error('useOmni must be used inside <OmniProvider>')
  return ctx
}
