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
  count: number
  /** Renders the count in flag-red — the wireframe's overdue treatment. */
  urgent?: boolean
}

/**
 * PLACEHOLDER. Real pinned views come from `saved_views` (02 §3.18) with live
 * counts — see `qk.savedViews.pinned()`. The seeded set is 06 §1.
 *
 * TODO(views): load from Supabase once `saved_views` + counts exist.
 */
export const PLACEHOLDER_PINNED_VIEWS: PinnedView[] = [
  { id: 'overdue', label: 'Overdue follow-ups', to: '/contacts?view=overdue', count: 4, urgent: true },
  { id: 'lybunt', label: 'LYBUNT', to: '/contacts?view=lybunt', count: 23 },
  { id: 'quiet-60', label: 'No contact 60+ days', to: '/contacts?view=quiet-60', count: 11 },
  { id: 'pledges', label: 'Pledges outstanding', to: '/giving?view=pledges-outstanding', count: 6 },
]
