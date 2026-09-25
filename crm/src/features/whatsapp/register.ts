/**
 * The one line that joins this feature to the Comms shell.
 *
 * The shell (features/comms) owns the rail and the layout; it renders whatever
 * is in the registry and never imports this feature, and this feature never
 * imports the shell's components. `slots.ts` is the whole contract between the
 * two, which is what lets both be built at once without either blocking.
 *
 * Importing this module is the registration — it is a side effect on purpose,
 * so a single import in `main.tsx` is all the wiring there is.
 */

import { registerCommsChannel } from '../comms/slots'
import { useWaUnreadCount } from '../../lib/queries/wa'
import { WhatsAppPane } from './WhatsAppPane'

registerCommsChannel({
  id: 'whatsapp',
  label: 'WhatsApp',
  useCount: useWaUnreadCount,
  Pane: WhatsAppPane,
})
