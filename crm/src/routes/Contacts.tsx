import { EmptyState } from '../components'
import { PageHeader } from '../features/shell/PageHeader'

/**
 * Contacts — spec 06. Views as lenses over one dataset.
 *
 * TODO(contacts): saved views (table / kanban / calendar), magic columns from
 * `contact_stats`, bulk-action sheet, and the seeded smart-view set (06 §1).
 */
export function ContactsRoute() {
  return (
    <>
      <PageHeader title="Contacts" subtitle="Every person, household and organisation" />
      <EmptyState
        title="Contact lists and saved views land here"
        hint="One dataset, many named lenses: filters + sort + layout + visible columns, with derived magic columns (days since contact, YTD giving, pledge balance, engagement tier) read straight from contact_stats."
      />
    </>
  )
}
