import { SettingsView } from '../features/settings/SettingsView'

/**
 * Settings — spec 06 §4: lookup lists, the automation-rule table, team &
 * roles, organisation details and the AI switches.
 *
 * TODO(06 §3/§4): editable sector benchmarks (they age), the admin data export
 * and the backup-status panel — all read-only reporting surfaces that arrive
 * with M8.
 */
export function SettingsRoute() {
  return <SettingsView />
}
