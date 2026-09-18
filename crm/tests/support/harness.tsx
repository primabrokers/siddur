/**
 * Shared plumbing for the four acceptance tests (spec 12 §2).
 *
 * Each test file mocks `src/lib/supabase` with the proxy exported here, then
 * calls `installWorld()` to point it at a fresh copy of the seeded Monday.
 * The app under test is the *real* app: real routes, real query modules, real
 * components. Only the transport is swapped.
 *
 * The clock is frozen with `toFake: ['Date']` — Date is fixed, `setTimeout`
 * stays real — so "advance three months" is one call and nothing that waits on
 * a timer (React, TanStack Query, the search debounce) deadlocks.
 */

import type { ReactElement } from 'react'
import { vi } from 'vitest'
import { render, type RenderResult } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient } from '@tanstack/react-query'
import { createFakeSupabase, type FakeSupabase, type Tables } from './fakeSupabase'
import { MONDAY, USER } from '../acceptance/fixtures'

/* ------------------------------------------------------- the mocked client */

interface Holder {
  fake: FakeSupabase | null
  /** What `functions.invoke('ai-quick-capture')` resolves to. */
  parse: { data: unknown; error: unknown } | null
}

const holder: Holder = { fake: null, parse: null }

const missing = (): never => {
  throw new Error('installWorld() has not been called for this test')
}

/**
 * A stand-in for the `supabase` singleton. It is a real object rather than a
 * getter-proxy so that destructuring in the modules under test keeps working.
 */
export const supabase = {
  from: (table: string) => (holder.fake ? holder.fake.client.from(table) : missing()),
  get auth() {
    return holder.fake ? (holder.fake.client.auth as Record<string, never>) : missing()
  },
  functions: {
    invoke: async () => {
      if (holder.parse) return holder.parse
      // Nothing stubbed: behave like an unconfigured project, which the capture
      // UI already handles by falling back to the manual form (09 §1).
      return { data: null, error: { message: 'ai_unconfigured' }, response: { status: 503 } }
    },
  },
}

export interface WorldOptions {
  tables: Tables
  user?: { id: string; email: string }
  /** Stub the Quick Capture parse; the shape is `CaptureParseResult`. */
  parse?: unknown
}

export function installWorld(options: WorldOptions): FakeSupabase {
  const fake = createFakeSupabase(options.tables, options.user ?? USER)
  holder.fake = fake
  holder.parse = options.parse === undefined ? null : { data: options.parse, error: null }
  return fake
}

export function stubParse(result: unknown): void {
  holder.parse = { data: result, error: null }
}

export function resetWorld(): void {
  holder.fake = null
  holder.parse = null
}

/* ------------------------------------------------------------------ clock */

/** Freeze the calendar without freezing timers. */
export function freezeClock(at: Date = MONDAY): void {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(at)
}

export function moveClockTo(at: Date): void {
  vi.setSystemTime(at)
}

export function thawClock(): void {
  vi.useRealTimers()
}

/* ----------------------------------------------------------------- render */

export function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

/**
 * Mount the whole app at a path. Imported lazily so the caller's `vi.mock`
 * calls are registered before `src/App` (and its query modules) load.
 */
export async function renderApp(path = '/', client: QueryClient = newClient()): Promise<RenderResult> {
  const { AppProviders, AppRoutes } = await import('../../src/App')
  const tree: ReactElement = (
    <AppProviders client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>
  )
  return render(tree)
}

/** Collapse whitespace so an assertion can match text that wraps in the DOM. */
export const flat = (text: string): string => text.replace(/\s+/g, ' ').trim()
