import type { ComponentType } from 'react'
import type { IconProps } from '../../components/icons'
import {
  IconContacts,
  IconGiving,
  IconPipeline,
  IconReports,
  IconSettings,
  IconToday,
} from '../../components/icons'

export interface NavItem {
  to: string
  label: string
  Icon: ComponentType<IconProps>
  /** `end` matching for the index route. */
  end?: boolean
  /** `[P2]` in the spec — shipped in the shell, thin for now. */
  phase2?: boolean
}

/** Sidebar order is the spec's: Today · Contacts · Pipeline · Giving · Reports (03 §1). */
export const PRIMARY_NAV: NavItem[] = [
  { to: '/', label: 'Today', Icon: IconToday, end: true },
  { to: '/contacts', label: 'Contacts', Icon: IconContacts },
  { to: '/pipeline', label: 'Pipeline', Icon: IconPipeline, phase2: true },
  { to: '/giving', label: 'Giving', Icon: IconGiving },
  { to: '/reports', label: 'Reports', Icon: IconReports, phase2: true },
]

export const SETTINGS_NAV: NavItem = { to: '/settings', label: 'Settings', Icon: IconSettings }

export interface PinnedView {
  id: string
  label: string
  to: string
  /** `undefined` while the count query is still in flight. */
  count: number | undefined
  /** Renders the count in flag-red — the wireframe's overdue treatment. */
  urgent?: boolean
}

/**
 * A view is urgent when working it to zero is *late*, not merely pending —
 * the overdue queue and the lapsing-donor rescue lists. Matched on the view's
 * own criteria rather than its name, so a renamed view keeps its treatment.
 */
export function isUrgentView(filters: {
  flag?: string
  due?: 'today' | 'overdue'
  donor_status?: string[]
}): boolean {
  if (filters.due === 'overdue' || filters.flag === 'overdue') return true
  return Boolean(filters.donor_status?.includes('pre_lapsed'))
}

/**
 * How many views the sidebar shows before it stops being navigation and starts
 * being a list. The rest live on the Contacts route's view picker (06 §1).
 */
export const PINNED_VIEW_LIMIT = 6
