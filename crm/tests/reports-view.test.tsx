/**
 * The Reports screen (06 §3, artboard A8) rendered against the offline
 * fixtures — the same payload builder `e2e/reports-fixture-server.mjs` serves,
 * so what these tests assert is what the screenshots show.
 *
 * The transport is the only thing stubbed: the real route, the real query
 * module, the real cards.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  buildCampaignDetail,
  buildDrill,
  buildLedger,
  buildOverview,
} from '../e2e/reports-fixtures.mjs'
import type { ReportOverview } from '../src/features/reports/types'
import { CampaignDetailRoute, ReportsRoute } from '../src/routes/Reports'

const TODAY = new Date('2026-08-28T00:00:00Z')
const LEDGER = buildLedger({ today: TODAY })

interface RpcCall {
  fn: string
  args: Record<string, unknown>
}

const calls: RpcCall[] = []
/** Set by a test to override what `report_overview` answers. */
let overviewOverride: Partial<ReportOverview> | null = null
let amountsHidden = false

vi.mock('../src/lib/supabase', () => ({
  isConfigured: true,
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      if (fn === 'report_overview') {
        const base = buildOverview({
          year: (args.p_year as number | null) ?? null,
          today: TODAY,
          amountsHidden,
          ledger: LEDGER,
        })
        return { data: { ...base, ...(overviewOverride ?? {}) }, error: null }
      }
      if (fn === 'report_drill') {
        return {
          data: buildDrill({
            key: args.p_key as never,
            year: (args.p_year as number | null) ?? null,
            arg: (args.p_arg as string | null) ?? null,
            today: TODAY,
            amountsHidden,
            ledger: LEDGER,
          }),
          error: null,
        }
      }
      if (fn === 'report_campaign_detail') {
        return {
          data: buildCampaignDetail(args.p_campaign_id as string, {
            today: TODAY,
            amountsHidden,
            ledger: LEDGER,
          }),
          error: null,
        }
      }
      return { data: null, error: { message: `no such function ${fn}` } }
    },
  },
}))

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } } })

function renderAt(path: string) {
  return render(
    <QueryClientProvider client={newClient()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/reports" element={<ReportsRoute />} />
          <Route path="/reports/campaigns/:id" element={<CampaignDetailRoute />} />
          <Route path="/contacts/:id" element={<div>contact profile</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function renderReports(path = '/reports') {
  const view = renderAt(path)
  await screen.findByRole('heading', { name: 'Reports' })
  return view
}

beforeEach(() => {
  calls.length = 0
  overviewOverride = null
  amountsHidden = false
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(TODAY)
  return () => vi.useRealTimers()
})

/* ------------------------------------------------------------ the six cards */

describe('the report gallery', () => {
  it('asks the database for this year, once, for the whole screen', async () => {
    await renderReports()
    await waitFor(() => expect(screen.getByLabelText('Donor retention')).toBeInTheDocument())
    const overviewCalls = calls.filter((call) => call.fn === 'report_overview')
    expect(overviewCalls).toHaveLength(1)
    expect(overviewCalls[0].args).toEqual({ p_year: 2026 })
  })

  it('shows all six cards from the one payload', async () => {
    await renderReports()
    await waitFor(() => expect(screen.getByLabelText('Donor retention')).toBeInTheDocument())
    for (const label of [
      'Donor retention',
      'Giving by month — 2026',
      'Donor segments — RFM, recomputed nightly',
      'Campaigns & appeals',
      'Gift Aid',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.getByLabelText(/Fundraiser activity/)).toBeInTheDocument()
  })

  it('says out loud that the numbers are queries, not stored totals (I-8)', async () => {
    await renderReports()
    expect(await screen.findByText(/grouped query against the ledger/)).toBeInTheDocument()
  })
})

describe('donor retention card', () => {
  it('leads with the rate and the year-on-year swing', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Donor retention')
    const expected = buildOverview({ year: 2026, today: TODAY, ledger: LEDGER }).retention
    // The headline is a button: clicking the rate opens the retained donors.
    expect(
      within(card).getByRole('button', { name: /^Donor retention/ }),
    ).toHaveTextContent(`${expected.rate}%`)
    expect(within(card).getByText(/pts vs last year/)).toBeInTheDocument()
  })

  it('draws our bar beside two neutral benchmark bars', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Donor retention')
    const bars = within(card).getAllByTestId('benchmark-bar')
    expect(bars).toHaveLength(3)
    expect(bars.filter((bar) => bar.dataset.benchmark === 'true')).toHaveLength(2)
    expect(within(card).getByText('Sector average')).toBeInTheDocument()
    expect(within(card).getByText('7+ year donors')).toBeInTheDocument()
    expect(within(card).getByText(/Benchmarks: FEP 2026/)).toBeInTheDocument()
  })

  it('offers new, repeat, reactivated and lapsed as click-throughs', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Donor retention')
    for (const label of ['New donors', 'Repeat', 'Reactivated', 'Lapsed']) {
      expect(within(card).getByRole('button', { name: new RegExp(`^${label}:`) })).toBeInTheDocument()
    }
  })

  it('opens the lapsed list — every number ends in people (06 §3)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderReports()
    const card = await screen.findByLabelText('Donor retention')
    await user.click(within(card).getByRole('button', { name: /^Lapsed:/ }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Lapsed · 2026')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByTestId('drill-list')).toBeInTheDocument())

    const drillCall = calls.find((call) => call.fn === 'report_drill')
    expect(drillCall?.args).toEqual({ p_key: 'retention_lapsed', p_year: 2026, p_arg: null })

    const expected = buildDrill({ key: 'retention_lapsed', year: 2026, today: TODAY, ledger: LEDGER })
    expect(within(dialog).getAllByRole('link')).toHaveLength(expected.length)
  })

  it('shows an empty state instead of a rate when there is no prior year', async () => {
    overviewOverride = {
      retention: {
        ...buildOverview({ year: 2026, today: TODAY, ledger: LEDGER }).retention,
        gave_prior: 0,
        rate: null,
        delta_pts: null,
      },
    }
    await renderReports()
    const card = await screen.findByLabelText('Donor retention')
    expect(within(card).getByTestId('chart-empty')).toHaveTextContent(/Not enough history yet/)
  })
})

describe('giving chart', () => {
  it('draws one bar per bucket, anchored and rounded', async () => {
    const { container } = await renderReports()
    const card = await screen.findByLabelText('Giving by month — 2026')
    const marks = within(card).getAllByTestId('bar-mark')
    const expected = buildOverview({ year: 2026, today: TODAY, ledger: LEDGER }).giving.buckets
    expect(marks).toHaveLength(expected.length)

    // Each drawn bar is a rounded rect plus a 4px square base rect at the
    // baseline — the wireframe's data-end technique.
    const drawn = marks.filter((mark) => mark.querySelectorAll('rect[rx="4"]').length > 0)
    expect(drawn.length).toBeGreaterThan(0)
    const rounded = drawn[0].querySelector('rect[rx="4"]') as SVGRectElement
    const base = drawn[0].querySelectorAll('rect')[2] as SVGRectElement
    expect(base.getAttribute('height')).toBe('4')
    expect(Number(base.getAttribute('y')) + 4).toBe(150)
    expect(Number(rounded.getAttribute('y')) + Number(rounded.getAttribute('height'))).toBe(150)

    // Tooltips live in the DOM, one per mark, plus the chart's own aria-label.
    expect(container.querySelectorAll('[data-testid="bar-mark"] title').length).toBe(marks.length)
    expect(within(card).getByTestId('giving-bar-chart')).toHaveAttribute('aria-label', expect.stringContaining('Giving per month'))
  })

  it('labels the peak', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Giving by month — 2026')
    const peak = within(card).getByTestId('peak-label')
    const expected = buildOverview({ year: 2026, today: TODAY, ledger: LEDGER }).giving
    const peakBucket = expected.buckets.find((bucket) => bucket.bucket_key === expected.peak_key)
    expect(peak.textContent).toContain(peakBucket?.label)
    expect(within(card).getAllByTestId('bar-mark').filter((mark) => mark.dataset.peak === 'true')).toHaveLength(1)
  })

  it('opens the donors behind a month when its bar is clicked', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderReports()
    const card = await screen.findByLabelText('Giving by month — 2026')
    const mark = within(card).getAllByTestId('bar-mark')[2]
    await user.click(mark)

    const dialog = await screen.findByRole('dialog')
    const drillCall = calls.find((call) => call.fn === 'report_drill')
    expect(drillCall?.args.p_key).toBe('bucket')
    expect(drillCall?.args.p_arg).toBe(mark.dataset.bucket)
    await waitFor(() => expect(within(dialog).getByTestId('drill-list')).toBeInTheDocument())
  })

  it('says "not enough history yet" rather than drawing a lonely bar', async () => {
    const base = buildOverview({ year: 2026, today: TODAY, ledger: LEDGER })
    overviewOverride = {
      giving: { ...base.giving, buckets: base.giving.buckets.slice(0, 1) },
    }
    await renderReports()
    const card = await screen.findByLabelText('Giving by month — 2026')
    expect(within(card).getByTestId('chart-empty')).toHaveTextContent(/Not enough history yet/)
    expect(within(card).queryByTestId('giving-bar-chart')).not.toBeInTheDocument()
  })
})

describe('RFM tiles', () => {
  it('shows the six personas with the two alerts marked', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Donor segments — RFM, recomputed nightly')
    const tiles = within(card).getAllByTestId('rfm-tile')
    expect(tiles.map((tile) => tile.dataset.segment)).toEqual([
      'Champions',
      'Loyal',
      'New & Promising',
      'At-Risk',
      "Can't Lose Them",
      'Small & Steady',
    ])
    expect(tiles.filter((tile) => tile.dataset.alert === 'true').map((tile) => tile.dataset.segment)).toEqual([
      'At-Risk',
      "Can't Lose Them",
    ])
  })

  it('shows movement since the last recompute', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Donor segments — RFM, recomputed nightly')
    const champions = within(card).getAllByTestId('rfm-tile')[0]
    expect(champions.textContent).toMatch(/▲ 2/)
    const atRisk = within(card).getAllByTestId('rfm-tile')[3]
    expect(atRisk.textContent).toMatch(/act now/)
  })

  it('opens the tag list from a tile', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderReports()
    const card = await screen.findByLabelText('Donor segments — RFM, recomputed nightly')
    await user.click(within(card).getAllByTestId('rfm-tile')[3])

    await screen.findByRole('dialog')
    const drillCall = calls.find((call) => call.fn === 'report_drill')
    expect(drillCall?.args).toEqual({ p_key: 'rfm', p_year: null, p_arg: 'At-Risk' })
  })

  it('shows the floor rule when the nightly run refused to segment', async () => {
    const base = buildOverview({ year: 2026, today: TODAY, ledger: LEDGER })
    overviewOverride = {
      rfm: {
        ...base.rfm,
        computed_at: null,
        segments: base.rfm.segments.map((segment) => ({ ...segment, headcount: 0, previous: null })),
      },
    }
    await renderReports()
    const card = await screen.findByLabelText('Donor segments — RFM, recomputed nightly')
    expect(within(card).getByTestId('chart-empty')).toHaveTextContent(/at least five donors/)
  })
})

describe('campaigns and appeals card', () => {
  it('shows progress against goal and the pledged tail separately', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Campaigns & appeals')
    expect(within(card).getByRole('link', { name: 'Building campaign' })).toHaveAttribute(
      'href',
      '/reports/campaigns/camp-building',
    )
    expect(within(card).getByText(/pledged, not yet paid/)).toBeInTheDocument()
  })

  it('carries the appeal year-on-year line', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Campaigns & appeals')
    expect(within(card).getByText(/vs Dinner 2025/)).toBeInTheDocument()
  })
})

describe('fundraiser activity and Gift Aid', () => {
  it('lists the team with their interactions, tasks and gifts', async () => {
    await renderReports()
    const card = await screen.findByLabelText(/Fundraiser activity/)
    expect(within(card).getByRole('columnheader', { name: 'Interactions' })).toBeInTheDocument()
    expect(within(card).getByText('Avi Braun')).toBeInTheDocument()
  })

  it('shows claimed, recoverable and declaration coverage', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Gift Aid')
    expect(within(card).getByText('Claimed this period')).toBeInTheDocument()
    expect(within(card).getByText('Recoverable outstanding')).toBeInTheDocument()
    expect(within(card).getByText('Declaration coverage')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /^Missing declarations:/ })).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------- the period toggle */

describe('the period toggle', () => {
  it('re-scopes every card with one round trip', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await renderReports()
    await screen.findByLabelText('Giving by month — 2026')

    await user.click(screen.getByRole('button', { name: 'Last year' }))
    await screen.findByLabelText('Giving by month — 2025')
    expect(calls.filter((call) => call.fn === 'report_overview').at(-1)?.args).toEqual({ p_year: 2025 })

    await user.click(screen.getByRole('button', { name: 'All time' }))
    await screen.findByLabelText('Giving by year — all time')
    expect(calls.filter((call) => call.fn === 'report_overview').at(-1)?.args).toEqual({ p_year: null })
  })
})

/* ------------------------------------------------------------- redaction */

describe('a viewer who may not see amounts (11 §2)', () => {
  beforeEach(() => {
    amountsHidden = true
  })

  it('says so, once, at the top', async () => {
    await renderReports()
    expect(await screen.findByTestId('amounts-hidden-note')).toHaveTextContent(
      /Amounts hidden for your role/,
    )
  })

  it('keeps the retention card whole — the rate is a ratio, not an amount', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Donor retention')
    const expected = buildOverview({ year: 2026, today: TODAY, ledger: LEDGER }).retention
    expect(
      within(card).getByRole('button', { name: /^Donor retention/ }),
    ).toHaveTextContent(`${expected.rate}%`)
    expect(within(card).getByRole('button', { name: /^Lapsed:/ })).toBeInTheDocument()
  })

  it('plots gift counts instead of money, and says which', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Giving by month — 2026')
    expect(within(card).getByText(/Bars show gift counts/)).toBeInTheDocument()
    expect(within(card).getByTestId('giving-bar-chart')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Amounts hidden for your role'),
    )
    expect(within(card).queryByText(/£/)).not.toBeInTheDocument()
  })

  it('turns the campaign card count-based', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Campaigns & appeals')
    expect(within(card).getAllByText(/of goal/).length).toBeGreaterThan(0)
    expect(within(card).getAllByText(/gifts/).length).toBeGreaterThan(0)
    expect(within(card).queryByText(/pledged, not yet paid/)).not.toBeInTheDocument()
  })

  it('shows no money on the Gift Aid card but keeps the coverage lever', async () => {
    await renderReports()
    const card = await screen.findByLabelText('Gift Aid')
    expect(within(card).queryByText(/£/)).not.toBeInTheDocument()
    expect(within(card).getByText('Declaration coverage')).toBeInTheDocument()
  })
})

/* ------------------------------------------------------- the campaign page */

describe('the campaign page (05 §4)', () => {
  it('shows the ring, the appeal split, top gifts, pledges and the gifts table', async () => {
    renderAt('/reports/campaigns/camp-building')
    await screen.findByRole('heading', { name: 'Building campaign' })
    expect(await screen.findByTestId('progress-ring')).toBeInTheDocument()

    const expected = buildCampaignDetail('camp-building', { today: TODAY, ledger: LEDGER })
    expect(screen.getByLabelText('Progress against goal')).toHaveTextContent(
      `${expected.progress?.pct}%`,
    )
    expect(screen.getByLabelText('Per-appeal breakdown')).toHaveTextContent('Dinner 2026')
    expect(screen.getByLabelText('Top gifts')).toBeInTheDocument()
    expect(screen.getByLabelText('Pledges outstanding')).toHaveTextContent('overdue')

    const gifts = screen.getByLabelText('Gifts')
    expect(within(gifts).getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument()
    expect(within(gifts).getAllByRole('row')).toHaveLength(expected.gifts.length + 1)

    const detailCall = calls.find((call) => call.fn === 'report_campaign_detail')
    expect(detailCall?.args).toEqual({ p_campaign_id: 'camp-building' })
  })

  it('drops the amount column for a restricted viewer', async () => {
    amountsHidden = true
    renderAt('/reports/campaigns/camp-building')
    await screen.findByRole('heading', { name: 'Building campaign' })
    expect(screen.getByTestId('amounts-hidden-note')).toBeInTheDocument()
    const gifts = screen.getByLabelText('Gifts')
    expect(within(gifts).queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument()
  })
})
