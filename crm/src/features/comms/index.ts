/**
 * The Comms shell (10 §3). The route imports from here; other features never
 * import a file inside this folder directly.
 *
 * WhatsApp and any future channel reach the rail through `slots.ts` only — the
 * shell renders whatever registered itself, and neither side imports the
 * other. `core.ts` is exported because the two edge functions mirror it and
 * the tests assert on it; nothing else should need it.
 */

export { CommsView } from './CommsView'
export { ComposeSheet, BLANK_DRAFT } from './ComposeSheet'
export type { ComposeInitial, ComposeSheetProps } from './ComposeSheet'
export { ContactPickerSheet } from './ContactPickerSheet'
export { EmailList } from './EmailList'
export type { EmailListProps } from './EmailList'
export { EmailThreadView } from './EmailThreadView'
export type { EmailThreadViewProps, ReplyMode } from './EmailThreadView'
export { commsChannels, registerCommsChannel } from './slots'
export type { CommsChannelPane } from './slots'
export * from './core'
