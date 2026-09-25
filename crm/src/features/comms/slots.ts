/**
 * Slot contract between the Comms shell (email agent's territory) and the
 * WhatsApp feature (whatsapp agent's territory). The shell renders whatever
 * is registered here; neither side imports the other's files directly.
 */
import type { ComponentType } from 'react'

export interface CommsChannelPane {
  /** Stable key, e.g. 'whatsapp'. */
  id: string
  /** Rail label, e.g. 'WhatsApp'. */
  label: string
  /** Unread/attention count for the rail badge; undefined while loading. */
  useCount?: () => number | undefined
  /** The full pane (list + thread) rendered when the rail entry is active. */
  Pane: ComponentType
}

const registry: CommsChannelPane[] = []

export function registerCommsChannel(pane: CommsChannelPane): void {
  if (!registry.some((entry) => entry.id === pane.id)) registry.push(pane)
}

export function commsChannels(): readonly CommsChannelPane[] {
  return registry
}
