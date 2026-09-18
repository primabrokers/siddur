import { Navigate, useParams } from 'react-router'
import { ContactProfile } from '../features/contacts/ContactProfile'

/**
 * Donor profile — spec 04 §5. Header, pinned note, merged timeline, giving,
 * details and the right rail; act from the record without leaving it.
 */
export function ContactDetailRoute() {
  const { id } = useParams<{ id: string }>()
  if (!id) return <Navigate to="/contacts" replace />
  return <ContactProfile id={id} />
}
