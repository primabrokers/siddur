import { ContactsList } from '../features/contacts/ContactsList'

/**
 * Contacts — spec 06 §1. M1 ships the person-row list with a client-side quick
 * filter, the flag sort (I-3) and the create sheet with the duplicate check at
 * the door (02 §6).
 *
 * TODO(M5/06 §1): saved views (table / kanban / calendar), the seeded smart-view
 * set with live counts, addable magic columns and the bulk-action sheet.
 */
export function ContactsRoute() {
  return <ContactsList />
}
