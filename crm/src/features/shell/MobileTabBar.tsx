import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { cn } from '../../lib/cn'
import {
  IconContacts,
  IconGiving,
  IconMore,
  IconPipeline,
  IconPlus,
  IconReports,
  IconSettings,
  IconToday,
  Sheet,
} from '../../components'
import { useAuth } from '../auth/AuthProvider'
import { useCapture } from '../capture/QuickCapture'

const tab = 'flex min-w-[56px] flex-col items-center gap-[3px]'
const label = 'text-[10.5px]'

/** Bottom tab bar — Today · Contacts · [ + ] · Giving · More (MobileToday.dc.html). */
export function MobileTabBar() {
  const { openCapture } = useCapture()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [moreOpen, setMoreOpen] = useState(false)

  const go = (to: string) => {
    setMoreOpen(false)
    navigate(to)
  }

  return (
    <>
      <nav
        aria-label="Primary"
        className="flex items-center justify-around border-t border-border bg-surface px-2 pt-[10px] pb-safe lg:hidden"
      >
        <NavLink to="/" end className={({ isActive }) => cn(tab, isActive ? 'text-accent-dark' : 'text-faint')}>
          {({ isActive }) => (
            <>
              <IconToday size={20} />
              <span className={cn(label, isActive && 'font-bold')}>Today</span>
            </>
          )}
        </NavLink>

        <NavLink to="/contacts" className={({ isActive }) => cn(tab, isActive ? 'text-accent-dark' : 'text-faint')}>
          {({ isActive }) => (
            <>
              <IconContacts size={20} />
              <span className={cn(label, isActive && 'font-bold')}>Contacts</span>
            </>
          )}
        </NavLink>

        {/* The Magic Plus — always Quick Capture (03 §1). */}
        <button
          type="button"
          onClick={openCapture}
          aria-label="Quick capture"
          className="-mt-[26px] flex h-[54px] w-[54px] items-center justify-center rounded-full bg-accent text-surface shadow-[0_3px_10px_rgba(14,110,107,.35)]"
        >
          <IconPlus size={24} />
        </button>

        <NavLink to="/giving" className={({ isActive }) => cn(tab, isActive ? 'text-accent-dark' : 'text-faint')}>
          {({ isActive }) => (
            <>
              <IconGiving size={20} />
              <span className={cn(label, isActive && 'font-bold')}>Giving</span>
            </>
          )}
        </NavLink>

        <button type="button" onClick={() => setMoreOpen(true)} className={cn(tab, 'text-faint')}>
          <IconMore size={20} />
          <span className={label}>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="flex flex-col">
          {[
            { to: '/pipeline', label: 'Pipeline', Icon: IconPipeline },
            { to: '/reports', label: 'Reports', Icon: IconReports },
            { to: '/settings', label: 'Settings', Icon: IconSettings },
          ].map(({ to, label: text, Icon }) => (
            <button
              key={to}
              type="button"
              onClick={() => go(to)}
              className="flex items-center gap-[10px] rounded-input px-2 py-3 text-left text-[14px] text-nav hover:bg-ground"
            >
              <Icon size={18} />
              {text}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setMoreOpen(false)
              void signOut()
            }}
            className="mt-2 rounded-input px-2 py-3 text-left text-[14px] text-muted hover:bg-ground"
          >
            Sign out
          </button>
        </div>
      </Sheet>
    </>
  )
}
