import { ContactsWorkspace } from '../features/views/ContactsWorkspace'

/**
 * Contacts — spec 06 §1. The person-row list with the flag sort (I-3), the
 * create sheet with its duplicate check at the door (02 §6), and the saved
 * views that turn the same dataset into named work queues (03 §4).
 *
 * TODO(06 §1): the kanban and calendar layouts, addable magic columns, and the
 * multi-select bulk-action sheet. The table layout and the view mechanism
 * itself are here; those three are additive on top of them.
 */
export function ContactsRoute() {
  return <ContactsWorkspace />
}
