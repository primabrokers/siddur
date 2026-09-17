import { EmptyState } from '../components'

/** Unified inbox — email folders + WhatsApp conversations. Replaced by features/comms. */
export function CommsRoute() {
  return (
    <EmptyState
      title="Inbox"
      hint="Email folders and WhatsApp conversations land here."
    />
  )
}
