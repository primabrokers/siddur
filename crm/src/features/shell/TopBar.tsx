import { useState } from 'react'
import { Avatar, IconPlus, IconSearch } from '../../components'
import { initialsOf } from '../../lib/format'
import { useAuth } from '../auth/AuthProvider'
import { useTeamMember } from '../auth/useTeamMember'
import { useCapture } from '../capture/QuickCapture'
import { useOmni } from '../search/OmniProvider'

/** Desktop top bar — search, quick capture, user. Per `wireframes/Main.dc.html`. */
export function TopBar() {
  const { openCapture } = useCapture()
  const { openSearch, openPalette } = useOmni()
  const { user, signOut } = useAuth()
  const { data: member } = useTeamMember()
  const [menuOpen, setMenuOpen] = useState(false)

  const displayName = member?.full_name ?? user?.email ?? 'You'

  return (
    <header className="hidden items-center gap-3 border-b border-border bg-surface px-6 py-3 lg:flex">
      {/* The field is a button on purpose: "/" and this click open the same
          overlay, so there is one search surface rather than two (03 §3). */}
      <button
        type="button"
        onClick={openSearch}
        aria-label="Search people, phones, cities"
        className="flex max-w-[460px] grow items-center gap-2 rounded-input border border-border px-3 py-[7px] text-[13px] text-faint hover:border-faint"
      >
        <IconSearch size={14} />
        Search people, phones, cities…
        <span className="ml-auto rounded-[4px] border border-border px-[5px] text-[11px]">/</span>
      </button>

      <div className="ml-auto flex items-center gap-[10px]">
        <button
          type="button"
          onClick={openPalette}
          aria-label="Open the command palette"
          title="Commands (⌘K)"
          className="rounded-input border border-border px-[9px] py-[6px] text-[11.5px] text-muted hover:border-faint hover:text-ink"
        >
          ⌘K
        </button>

        <button
          type="button"
          onClick={openCapture}
          className="flex items-center gap-[6px] rounded-input bg-accent px-[14px] py-2 text-[13px] font-semibold text-surface hover:bg-accent-dark"
        >
          <IconPlus size={13} />
          Quick capture
        </button>

        <div className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Account: ${displayName}`}
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-full"
          >
            <Avatar name={displayName} initials={initialsOf(displayName)} tone="accent" />
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="dc-fade-enter absolute right-0 z-40 mt-2 w-[220px] rounded-card border border-border bg-surface p-2 shadow-[0_3px_14px_rgba(31,41,51,.14)]"
            >
              <div className="px-2 py-[6px]">
                <div className="truncate text-[13px] font-semibold">{displayName}</div>
                <div className="truncate text-[11.5px] text-muted">{member?.role ?? user?.email ?? '—'}</div>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  void signOut()
                }}
                className="w-full rounded-input px-2 py-[6px] text-left text-[13px] text-nav hover:bg-ground"
              >
                Sign out
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
