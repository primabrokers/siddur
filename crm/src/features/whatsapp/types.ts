/**
 * Row shapes for the WhatsApp tables of migration 012, plus the two view
 * models the pane renders from. Mirrors the SQL exactly — nothing here is
 * derived; derivation lives in `core.ts`.
 */

import type { ContactRow } from '../contacts/types'
import type { WaDirection, WaMatchedBy, WaMessageType, WaStatus, WaWindowState } from './core'

export interface WaConversationRow {
  id: string
  wa_id: string
  profile_name: string | null
  contact_id: string | null
  matched_by: WaMatchedBy | null
  last_inbound_at: string | null
  last_message_at: string | null
  unread_count: number
  created_at?: string
  updated_at?: string
}

export interface WaMessageRow {
  id: string
  conversation_id: string
  direction: WaDirection
  wa_message_id: string | null
  msg_type: WaMessageType
  body: string | null
  media_id: string | null
  media_mime: string | null
  media_url: string | null
  template_name: string | null
  status: WaStatus
  error_detail: string | null
  occurred_at: string
  sent_by: string | null
  created_at?: string
}

export interface WaTemplateRow {
  id: string
  name: string
  language: string
  category: string | null
  body: string | null
  /** Meta's own: APPROVED / PENDING / REJECTED / PAUSED / DISABLED. */
  status: string
  synced_at: string
}

/** One row of the conversation list. */
export interface WaConversationItem {
  conversation: WaConversationRow
  /** Null when the number matched nobody — a normal state, shown as such. */
  contact: ContactRow | null
  /** Computed from `last_inbound_at` on every render (I-9). */
  window: WaWindowState
  /** Last message's body, trimmed for the list. */
  snippet: string
  /** Last message's instant — `last_message_at`, or the conversation's creation. */
  at: string | null
}

/**
 * What the Settings card knows about the four secrets, probed rather than
 * read: the browser can never see a Supabase secret, so each answer comes from
 * the deployed function's own behaviour.
 */
export interface WaConfigStatus {
  /** wa-send answered 200 to `action: 'status'` — token + phone number id set. */
  sendConfigured: boolean
  /** wa-webhook's GET handshake found WA_VERIFY_TOKEN. */
  verifyTokenSet: boolean
  /** wa-webhook's POST found WA_APP_SECRET. */
  appSecretSet: boolean
  /** The sync endpoint additionally needs the WhatsApp Business Account id. */
  templatesSyncable: boolean
  /** The URL to paste into the Meta app's webhook configuration. */
  callbackUrl: string
  /** Set when a probe could not be made at all (offline, functions unreachable). */
  probeError: string | null
}
