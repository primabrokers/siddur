import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { cn } from '../../lib/cn'
import { useAuth } from '../auth/AuthProvider'
import { useCapture } from '../capture/QuickCapture'
import { CommandDialog, KeyHint } from './CommandDialog'
import {
  COMMAND_GROUP_LABEL,
  groupCommands,
  rankCommands,
  type Command,
  type CommandContext,
} from './commands'
import { readUsage, recordUsage, type UsageCounts } from './recents'

export interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

/**
 * The Cmd/Ctrl+K palette (03 §3).
 *
 * Superhuman's rules: fuzzy matching with synonyms, every row teaching its own
 * keyboard shortcut, context-aware ranking (this screen's actions first, then
 * the ones you actually use), and useful default suggestions before a single
 * keystroke.
 *
 * The palette owns no behaviour. Each command dispatches into a surface that
 * already exists — Quick Capture's provider, the router — so there is exactly
 * one implementation of every action in the app.
 */
export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { signOut } = useAuth()
  const { openCapture } = useCapture()

  const [term, setTerm] = useState('')
  const [cursor, setCursor] = useState(0)
  const [usage, setUsage] = useState<UsageCounts>({})
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    setTerm('')
    setCursor(0)
    setUsage(readUsage())
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  const ranked = useMemo(
    () => rankCommands(term, { pathname: location.pathname, usage }),
    [term, location.pathname, usage],
  )
  const flat = useMemo(() => ranked.map((row) => row.command), [ranked])
  const groups = useMemo(() => groupCommands(ranked), [ranked])

  useEffect(() => {
    setCursor(0)
  }, [term])

  useEffect(() => {
    // `scrollIntoView` is absent in jsdom and in a few older engines; keeping
    // the highlight in view is a nicety, never a requirement.
    const node = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    node?.scrollIntoView?.({ block: 'nearest' })
  }, [cursor, flat.length])

  const context: CommandContext = {
    navigate: (to) => navigate(to),
    openCapture: () => openCapture(),
    signOut: () => void signOut(),
  }

  function run(command: Command | undefined) {
    if (!command) return
    recordUsage(command.id)
    onClose()
    command.run(context)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setCursor((value) => (flat.length === 0 ? 0 : (value + 1) % flat.length))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setCursor((value) => (flat.length === 0 ? 0 : (value - 1 + flat.length) % flat.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(flat[cursor])
    }
  }

  return (
    <CommandDialog
      open={open}
      onClose={onClose}
      title="Commands"
      input={
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="shrink-0 text-[13px] font-semibold text-faint">
            ⌘
          </span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="command-results"
            aria-autocomplete="list"
            aria-label="Type a command"
            placeholder="Type a command…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            onKeyDown={onKeyDown}
            className="w-full bg-transparent text-[15px] placeholder:text-faint focus:outline-none"
          />
        </div>
      }
      footer={
        <span className="flex flex-wrap items-center gap-4">
          <KeyHint keys="↑ ↓" label="move" />
          <KeyHint keys="↵" label="run" />
          <KeyHint keys="esc" label="close" />
          <span className="ml-auto hidden sm:inline">
            <KeyHint keys="/" label="search people" />
          </span>
        </span>
      }
    >
      <div ref={listRef} id="command-results" role="listbox" aria-label="Commands">
        {groups.map((group) => (
          <div key={group.group}>
            <div className="px-2 pt-2 pb-[6px] text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">
              {COMMAND_GROUP_LABEL[group.group]}
            </div>
            {group.items.map((command) => {
              const active = flat[cursor]?.id === command.id
              return (
                <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => run(command)}
                  onMouseMove={() => setCursor(flat.findIndex((item) => item.id === command.id))}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-input px-3 py-[9px] text-left text-[13.5px]',
                    active ? 'bg-accent-soft font-semibold text-accent-dark' : 'hover:bg-ground',
                  )}
                >
                  <span className="min-w-0 grow truncate">{command.label}</span>
                  {command.shortcut ? (
                    <kbd className="shrink-0 rounded-[4px] border border-border px-[6px] py-[1px] font-sans text-[11px] text-muted">
                      {command.shortcut}
                    </kbd>
                  ) : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>

      {flat.length === 0 ? (
        <p className="px-3 py-6 text-center text-[13px] text-muted">
          No command matches “{term.trim()}”.
        </p>
      ) : null}
    </CommandDialog>
  )
}
