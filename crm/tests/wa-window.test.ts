import { describe, expect, it } from 'vitest'
import {
  WA_WINDOW_MS,
  WA_WINDOW_CLOSED_BANNER,
  composerState,
  windowOpen,
  windowRemainingLabel,
  windowState,
} from '../src/features/whatsapp/core'

/**
 * The 24-hour customer-service window (10 §2 Tier 2).
 *
 * This is the compliance rule of the whole integration, so it is tested at the
 * boundary rather than in the middle: one millisecond either side of 24 hours,
 * and the never-inbound case that must never be mistaken for "just expired".
 */

const T0 = Date.parse('2026-09-18T09:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('the 24-hour window', () => {
  it('is 24 hours, stated once', () => {
    expect(WA_WINDOW_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('is open immediately after an inbound message', () => {
    expect(windowOpen(iso(T0), T0)).toBe(true)
    expect(windowOpen(iso(T0), T0 + 1)).toBe(true)
  })

  it('is open one millisecond before the boundary', () => {
    expect(windowOpen(iso(T0), T0 + WA_WINDOW_MS - 1)).toBe(true)
  })

  it('is CLOSED exactly at 24 hours — the safe side of the boundary', () => {
    // Erring toward the template costs a template. Erring toward free-form is
    // a policy breach, so the boundary belongs to "closed".
    expect(windowOpen(iso(T0), T0 + WA_WINDOW_MS)).toBe(false)
  })

  it('is closed after the boundary', () => {
    expect(windowOpen(iso(T0), T0 + WA_WINDOW_MS + 1)).toBe(false)
    expect(windowOpen(iso(T0), T0 + 48 * 60 * 60 * 1000)).toBe(false)
  })

  it('reports the expiry instant and the time left', () => {
    const state = windowState(iso(T0), T0 + 60_000)
    expect(state.expiresAt).toBe(iso(T0 + WA_WINDOW_MS))
    expect(state.msRemaining).toBe(WA_WINDOW_MS - 60_000)
    expect(state.neverInbound).toBe(false)
  })

  it('clamps the remaining time at zero once closed', () => {
    expect(windowState(iso(T0), T0 + WA_WINDOW_MS + 5_000).msRemaining).toBe(0)
  })

  describe('never inbound', () => {
    it.each([null, undefined, ''])('%s is closed, and flagged as never-inbound', (value) => {
      const state = windowState(value as string | null, T0)
      expect(state.open).toBe(false)
      expect(state.neverInbound).toBe(true)
      expect(state.expiresAt).toBeNull()
    })

    it('treats an unparseable timestamp as never-inbound rather than open', () => {
      const state = windowState('not a date', T0)
      expect(state.open).toBe(false)
      expect(state.neverInbound).toBe(true)
    })
  })

  describe('the countdown label', () => {
    it('reads in hours above two hours', () => {
      expect(windowRemainingLabel(windowState(iso(T0), T0))).toBe('24h left')
      expect(windowRemainingLabel(windowState(iso(T0), T0 + 20 * 60 * 60 * 1000))).toBe('4h left')
    })

    it('reads in minutes below two hours', () => {
      expect(windowRemainingLabel(windowState(iso(T0), T0 + WA_WINDOW_MS - 45 * 60_000))).toBe('45m left')
    })

    it('says so in the final minute', () => {
      expect(windowRemainingLabel(windowState(iso(T0), T0 + WA_WINDOW_MS - 30_000))).toBe('under a minute left')
    })

    it('is "closed" once shut', () => {
      expect(windowRemainingLabel(windowState(iso(T0), T0 + WA_WINDOW_MS))).toBe('closed')
    })
  })
})

describe('the composer state machine', () => {
  const base = { hasConversation: true, templateCount: 3, nowMs: T0 }

  it('offers free text inside the window', () => {
    const state = composerState({ ...base, lastInboundAt: iso(T0 - 60_000) })
    expect(state.mode).toBe('free_form')
    expect(state.canSendFreeForm).toBe(true)
    expect(state.notice).toBeNull()
  })

  it('replaces free text with the template picker outside the window', () => {
    const state = composerState({ ...base, lastInboundAt: iso(T0 - WA_WINDOW_MS) })
    expect(state.mode).toBe('template_required')
    expect(state.canSendFreeForm).toBe(false)
    expect(state.canSendTemplate).toBe(true)
    expect(state.notice).toBe(WA_WINDOW_CLOSED_BANNER)
  })

  it('explains the approval workflow when the window is shut and nothing is approved', () => {
    const state = composerState({ ...base, templateCount: 0, lastInboundAt: iso(T0 - WA_WINDOW_MS) })
    expect(state.mode).toBe('template_unavailable')
    expect(state.canSendFreeForm).toBe(false)
    expect(state.canSendTemplate).toBe(false)
    expect(state.notice).toBe(WA_WINDOW_CLOSED_BANNER)
  })

  it('starts a brand-new conversation on a template, never on free text', () => {
    const state = composerState({ ...base, lastInboundAt: null })
    expect(state.mode).toBe('template_required')
    expect(state.canSendFreeForm).toBe(false)
  })

  it('offers nothing at all with no conversation selected', () => {
    const state = composerState({ ...base, hasConversation: false, lastInboundAt: iso(T0) })
    expect(state.mode).toBe('idle')
    expect(state.canSendFreeForm).toBe(false)
    expect(state.canSendTemplate).toBe(false)
  })

  it('still allows a template inside the window — the picker is a choice, not a punishment', () => {
    const state = composerState({ ...base, lastInboundAt: iso(T0 - 60_000) })
    expect(state.canSendTemplate).toBe(true)
  })
})
