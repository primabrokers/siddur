import { NavLink } from 'react-router'
import { cn } from '../../lib/cn'
import { useTeamMember } from '../auth/useTeamMember'
import { routeForView } from '../views/filterModel'
import { useSavedViews, useViewCounts } from '../../lib/queries/views'
import { PINNED_VIEW_LIMIT, PRIMARY_NAV, SETTINGS_NAV, isUrgentView } from './navigation'

const itemBase = 'flex items-center gap-[10px] rounded-input px-[10px] py-2 text-[13.5px] transition-colors'
const itemIdle = 'text-nav hover:bg-ground'
const itemActive = 'bg-accent-soft font-semibold text-accent-dark'

/**
 * PINNED VIEWS — the saved views this member can see, each with a live count
 * (06 §1: "counts live in the sidebar; a view at 0 is a satisfying grey").
 *
 * The counts are separate 60-second queries, one per view, so the sidebar
 * never pulls the rows it is not going to show.
 */
function PinnedViews() {
  const member = useTeamMember()
  const views = useSavedViews(member.data?.id ?? null)
  const pinned = (views.data ?? []).slice(0, PINNED_VIEW_LIMIT)
  const counts = useViewCounts(pinned)

  if (views.isPending) {
    return (
      <div className="flex flex-col gap-1 px-[10px] py-1" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[18px] animate-pulse rounded-[6px] bg-row" />
        ))}
      </div>
    )
  }

  if (pinned.length === 0) {
    return (
      <p className="px-[10px] py-1 text-[11.5px] text-faint">
        No saved views yet — filter the contacts list and save it.
      </p>
    )
  }

  return (
    <>
      {pinned.map((view) => {
        const count = counts[view.id]
        const urgent = isUrgentView(view.filters) && (count ?? 0) > 0
        return (
          <NavLink
            key={view.id}
            to={routeForView(view)}
            className="flex items-center justify-between rounded-input px-[10px] py-[6px] text-[13px] text-nav hover:bg-ground"
          >
            <span className="truncate">{view.name}</span>
            <span
              className={cn(
                'tabular ml-2 shrink-0 text-[11.5px]',
                count === undefined
                  ? 'text-faint'
                  : urgent
                    ? 'font-semibold text-flag-overdue'
                    : count === 0
                      ? 'text-faint'
                      : 'text-muted',
              )}
            >
              {count ?? '·'}
            </span>
          </NavLink>
        )
      })}
    </>
  )
}

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

      <PinnedViews />

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
