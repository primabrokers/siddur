import { NavLink } from 'react-router'
import { cn } from '../../lib/cn'
import { PLACEHOLDER_PINNED_VIEWS, PRIMARY_NAV, SETTINGS_NAV } from './navigation'

const itemBase = 'flex items-center gap-[10px] rounded-input px-[10px] py-2 text-[13.5px] transition-colors'
const itemIdle = 'text-nav hover:bg-ground'
const itemActive = 'bg-accent-soft font-semibold text-accent-dark'

/** Desktop sidebar — 216px, per `wireframes/Main.dc.html`. */
export function Sidebar() {
  const { Icon: SettingsIcon } = SETTINGS_NAV

  return (
    <nav
      aria-label="Primary"
      className="hidden w-[216px] shrink-0 flex-col gap-1 border-r border-border bg-surface px-3 py-4 lg:flex"
    >
      <div className="flex items-center gap-2 px-2 pt-1 pb-[14px]">
        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-accent text-[13px] font-bold text-surface">
          Y
        </span>
        <span className="text-[14px] font-bold">Yeshiva CRM</span>
      </div>

      {PRIMARY_NAV.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cn(itemBase, isActive ? itemActive : itemIdle)}>
          <Icon />
          {label}
        </NavLink>
      ))}

      <div className="mt-3 mb-[6px] px-2 text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">
        Pinned views
      </div>

      {PLACEHOLDER_PINNED_VIEWS.map((view) => (
        <NavLink
          key={view.id}
          to={view.to}
          className="flex items-center justify-between rounded-input px-[10px] py-[6px] text-[13px] text-nav hover:bg-ground"
        >
          <span className="truncate">{view.label}</span>
          <span
            className={cn(
              'tabular ml-2 shrink-0 text-[11.5px]',
              view.urgent ? 'font-semibold text-flag-overdue' : 'text-muted',
            )}
          >
            {view.count}
          </span>
        </NavLink>
      ))}

      <NavLink
        to={SETTINGS_NAV.to}
        className={({ isActive }) => cn(itemBase, 'mt-auto text-[13px]', isActive ? itemActive : itemIdle)}
      >
        <SettingsIcon />
        {SETTINGS_NAV.label}
      </NavLink>
    </nav>
  )
}
