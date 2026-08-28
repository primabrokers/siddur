/**
 * The presentation arithmetic in `features/reports/logic.ts` — bar geometry,
 * benchmark bar widths, movement arrows, delta wording.
 *
 * These are the only calculations the client is allowed to do (I-8: the numbers
 * themselves come from SQL), so they are the ones worth pinning: a bar that
 * floats off the baseline or a movement arrow pointing the wrong way is a
 * wrong-looking screen, not a wrong query.
 */

import { describe, expect, it } from 'vitest'
import {
  AMOUNTS_HIDDEN_NOTE,
  CHART_BOX,
  CHART_NEUTRAL,
  CHART_SERIES,
  CHART_STEP,
  appealHighlight,
  benchmarkBars,
  countsReconcile,
  deltaTone,
  formatDeltaPercent,
  formatDeltaPoints,
  formatPercent,
  givingBarPoints,
  hasEnoughHistory,
  layoutBars,
  peakLabel,
  progressFraction,
  retentionCounts,
  rfmHasSegmentation,
  scopeLabel,
  scopeToYear,
  segmentMovement,
} from '../src/features/reports/logic'
import type { AppealRow, GivingSummary, RetentionSummary, RfmSegment } from '../src/features/reports/types'

const TODAY = new Date('2026-08-28T00:00:00Z')

const retention = (patch: Partial<RetentionSummary> = {}): RetentionSummary => ({
  year: 2026,
  gave_prior: 100,
  retained: 61,
  new_donors: 31,
  repeat_donors: 61,
  reactivated: 9,
  lapsed: 27,
  current_donors: 101,
  rate: 61,
  prior_rate: 58,
  delta_pts: 3,
  benchmark_overall: 43,
  benchmark_7plus: 87,
  benchmark_source: 'FEP',
  benchmark_year: 2026,
  ...patch,
})

const segment = (patch: Partial<RfmSegment> = {}): RfmSegment => ({
  segment: 'Champions',
  tag_id: 'tag-1',
  headcount: 34,
  previous: 32,
  is_alert: false,
  sort_order: 1,
  ...patch,
})

/* -------------------------------------------------------------------- scope */

describe('period toggle', () => {
  it('maps the three chips onto the RPC argument', () => {
    expect(scopeToYear('this_year', TODAY)).toBe(2026)
    expect(scopeToYear('last_year', TODAY)).toBe(2025)
    expect(scopeToYear('all_time', TODAY)).toBeNull()
  })

  it('labels each period for the card headings', () => {
    expect(scopeLabel('this_year', TODAY)).toBe('2026')
    expect(scopeLabel('last_year', TODAY)).toBe('2025')
    expect(scopeLabel('all_time', TODAY)).toBe('All time')
  })
})

/* ------------------------------------------------------------------- deltas */

describe('year-on-year wording', () => {
  it('renders a rise, a fall and a dead heat differently', () => {
    expect(formatDeltaPoints(3)).toBe('▲ 3 pts vs last year')
    expect(formatDeltaPoints(-4.5)).toBe('▼ 4.5 pts vs last year')
    expect(formatDeltaPoints(0)).toBe('level with last year')
  })

  it('says nothing at all when there is no prior year', () => {
    expect(formatDeltaPoints(null)).toBeNull()
    expect(formatDeltaPoints(undefined)).toBeNull()
  })

  it('tones a rise green, a fall red and no movement grey', () => {
    expect(deltaTone(3)).toBe('good')
    expect(deltaTone(-3)).toBe('bad')
    expect(deltaTone(0)).toBe('muted')
    expect(deltaTone(null)).toBe('muted')
  })

  it('formats an appeal’s percentage swing', () => {
    expect(formatDeltaPercent(12)).toBe('▲ 12%')
    expect(formatDeltaPercent(-8.4)).toBe('▼ 8.4%')
    expect(formatDeltaPercent(0)).toBe('level')
    expect(formatDeltaPercent(null)).toBeNull()
  })

  it('prints percentages without trailing noise', () => {
    expect(formatPercent(61)).toBe('61%')
    expect(formatPercent(66.66)).toBe('66.7%')
    expect(formatPercent(null)).toBe('—')
  })
})

/* ---------------------------------------------------------------- retention */

describe('retention card figures', () => {
  it('colours our own bar and leaves both benchmarks neutral', () => {
    const bars = benchmarkBars(retention())
    expect(bars.map((bar) => bar.id)).toEqual(['you', 'sector', 'seven_plus'])
    expect(bars[0].fill).toBe(CHART_SERIES)
    expect(bars[0].isBenchmark).toBe(false)
    expect(bars[1].fill).toBe(CHART_NEUTRAL)
    expect(bars[2].fill).toBe(CHART_NEUTRAL)
    expect(bars.filter((bar) => bar.isBenchmark)).toHaveLength(2)
  })

  it('names the benchmark source and year in the tooltip, because benchmarks age', () => {
    const bars = benchmarkBars(retention())
    expect(bars[1].title).toContain('FEP 2026')
  })

  it('clamps bar widths into the track', () => {
    const bars = benchmarkBars(retention({ rate: 140 }))
    expect(bars[0].width).toBe(100)
    expect(benchmarkBars(retention({ rate: null }))[0].width).toBe(0)
  })

  it('offers the four cohort counts, each with the list behind it', () => {
    const counts = retentionCounts(retention())
    expect(counts.map((count) => count.drill)).toEqual([
      'retention_new',
      'retention_repeat',
      'retention_reactivated',
      'retention_lapsed',
    ])
    expect(counts.find((count) => count.id === 'lapsed')?.tone).toBe('bad')
  })

  it('checks that the three cohorts partition this year’s donors', () => {
    expect(countsReconcile(retention())).toBe(true)
    expect(countsReconcile(retention({ current_donors: 999 }))).toBe(false)
    expect(countsReconcile(null)).toBe(false)
  })
})

/* -------------------------------------------------------------- bar geometry */

describe('bar geometry', () => {
  const points = [
    { key: '2026-01', label: 'Jan', value: 4260, detail: '£4,260', isCurrent: false },
    { key: '2026-02', label: 'Feb', value: 9800, detail: '£9,800', isCurrent: false },
    { key: '2026-03', label: 'Mar', value: 34944, detail: '£34,944', isCurrent: false },
    { key: '2026-04', label: 'Apr', value: 0, detail: '£0', isCurrent: false },
    { key: '2026-05', label: 'May', value: 3610, detail: '£3,610', isCurrent: true },
  ]
  const layout = layoutBars(points)

  it('anchors every bar to the baseline', () => {
    for (const mark of layout.marks) {
      expect(mark.y + mark.height).toBeCloseTo(CHART_BOX.baseline, 5)
    }
  })

  it('puts the 4px square base rect flush against the baseline', () => {
    for (const mark of layout.marks) {
      expect(mark.baseY + CHART_BOX.radius).toBe(CHART_BOX.baseline)
    }
  })

  it('scales the tallest bar to the full plot height', () => {
    const tallest = layout.marks.find((mark) => mark.key === '2026-03')
    expect(tallest?.height).toBeCloseTo(CHART_BOX.baseline - CHART_BOX.top, 5)
    expect(tallest?.y).toBeCloseTo(CHART_BOX.top, 5)
  })

  it('draws nothing for a zero, and never less than the radius for a non-zero', () => {
    expect(layout.marks.find((mark) => mark.key === '2026-04')?.height).toBe(0)
    const tiny = layoutBars([
      { key: 'a', label: 'A', value: 1_000_000, detail: '', isCurrent: false },
      { key: 'b', label: 'B', value: 1, detail: '', isCurrent: false },
    ])
    expect(tiny.marks[1].height).toBe(CHART_BOX.radius)
  })

  it('keeps bars thin and inside the box', () => {
    for (const mark of layout.marks) {
      expect(mark.width).toBeLessThanOrEqual(CHART_BOX.maxBarWidth)
      expect(mark.x).toBeGreaterThanOrEqual(0)
      expect(mark.x + mark.width).toBeLessThanOrEqual(CHART_BOX.width)
    }
  })

  it('mutes the period still in progress and keeps the rest on one hue', () => {
    expect(layout.marks.find((mark) => mark.isCurrent)?.fill).toBe(CHART_STEP)
    expect(layout.marks.filter((mark) => !mark.isCurrent).every((mark) => mark.fill === CHART_SERIES)).toBe(
      true,
    )
  })

  it('labels exactly one peak, even when two periods tie', () => {
    const tied = layoutBars([
      { key: 'a', label: 'A', value: 50, detail: '', isCurrent: false },
      { key: 'b', label: 'B', value: 50, detail: '', isCurrent: false },
    ])
    expect(tied.marks.filter((mark) => mark.isPeak)).toHaveLength(1)
    expect(tied.peak?.key).toBe('a')
  })

  it('labels no peak in an all-zero chart', () => {
    const flat = layoutBars([
      { key: 'a', label: 'A', value: 0, detail: '', isCurrent: false },
      { key: 'b', label: 'B', value: 0, detail: '', isCurrent: false },
    ])
    expect(flat.peak).toBeNull()
    expect(peakLabel(flat, false)).toBeNull()
  })

  it('draws two recessive grid lines above the baseline', () => {
    expect(layout.gridY).toHaveLength(2)
    for (const y of layout.gridY) {
      expect(y).toBeLessThan(layout.baseline)
      expect(y).toBeGreaterThan(CHART_BOX.top)
    }
  })

  it('survives an empty series', () => {
    const empty = layoutBars([])
    expect(empty.marks).toEqual([])
    expect(empty.max).toBe(0)
    expect(empty.peak).toBeNull()
  })
})

describe('what the bars plot', () => {
  const giving: GivingSummary = {
    buckets: [
      { bucket_key: '2026-01', label: 'Jan', total: 4260, gift_count: 6, donor_count: 6, is_current: false },
      { bucket_key: '2026-02', label: 'Feb', total: 9800, gift_count: 5, donor_count: 5, is_current: true },
    ],
    total: 14060,
    gift_count: 11,
    peak_key: '2026-02',
  }

  it('plots money when the viewer may see it', () => {
    const points = givingBarPoints(giving, false)
    expect(points.map((point) => point.value)).toEqual([4260, 9800])
    expect(points[0].detail).toContain('£4,260')
    expect(points[0].detail).toContain('6 gifts')
  })

  it('falls back to gift counts — never to zeros — when amounts are hidden', () => {
    const points = givingBarPoints({ ...giving, buckets: giving.buckets.map((b) => ({ ...b, total: null })) }, true)
    expect(points.map((point) => point.value)).toEqual([6, 5])
    expect(points[0].detail).toContain('6 gifts')
    expect(points[0].detail).not.toContain('£')
  })

  it('names the peak with the quantity actually plotted', () => {
    expect(peakLabel(layoutBars(givingBarPoints(giving, false)), false)).toBe('£9,800 · Feb')
    expect(peakLabel(layoutBars(givingBarPoints(giving, true)), true)).toBe('6 gifts · Jan')
  })

  it('refuses to call one bar, or a row of zeros, a trend', () => {
    expect(hasEnoughHistory(givingBarPoints(giving, false))).toBe(true)
    expect(hasEnoughHistory([{ key: 'a', label: 'A', value: 10, detail: '', isCurrent: false }])).toBe(false)
    expect(
      hasEnoughHistory([
        { key: 'a', label: 'A', value: 0, detail: '', isCurrent: false },
        { key: 'b', label: 'B', value: 0, detail: '', isCurrent: false },
      ]),
    ).toBe(false)
  })
})

/* ------------------------------------------------------------- RFM movement */

describe('RFM tile movement', () => {
  it('shows a rise in a healthy segment as good news', () => {
    const movement = segmentMovement(segment({ headcount: 34, previous: 32 }))
    expect(movement).toMatchObject({ text: '▲ 2', tone: 'good', delta: 2 })
  })

  it('shows a rise in an alert segment as bad news, with the instruction', () => {
    const movement = segmentMovement(
      segment({ segment: 'At-Risk', is_alert: true, headcount: 21, previous: 17 }),
    )
    expect(movement.text).toBe('▲ 4 — act now')
    expect(movement.tone).toBe('alert')
  })

  it('reads a shrinking alert segment as progress', () => {
    const movement = segmentMovement(
      segment({ segment: 'At-Risk', is_alert: true, headcount: 12, previous: 20 }),
    )
    expect(movement).toMatchObject({ text: '▼ 8', tone: 'good' })
  })

  it('falls back to the segment’s descriptor when nothing moved', () => {
    expect(segmentMovement(segment({ segment: 'Loyal', headcount: 88, previous: 88 })).text).toBe(
      'steady',
    )
    expect(
      segmentMovement(segment({ segment: "Can't Lose Them", is_alert: true, headcount: 6, previous: 6 }))
        .text,
    ).toBe('high value, gone quiet')
    expect(
      segmentMovement(segment({ segment: 'Small & Steady', headcount: 203, previous: 203 })).text,
    ).toBe('the community base')
  })

  it('invents no delta before the second recompute', () => {
    const movement = segmentMovement(segment({ previous: null }))
    expect(movement.delta).toBeNull()
    expect(movement.text).toBe('your best relationships')
  })

  it('knows when the nightly run has not segmented anything', () => {
    const segments = [segment({ headcount: 0, previous: null })]
    expect(rfmHasSegmentation(segments, null)).toBe(false)
    expect(rfmHasSegmentation(segments, '2026-08-28T05:30:00Z')).toBe(false)
    expect(rfmHasSegmentation([segment({ headcount: 3 })], '2026-08-28T05:30:00Z')).toBe(true)
  })
})

/* ----------------------------------------------------------------- campaigns */

describe('campaigns and appeals', () => {
  const appeal = (patch: Partial<AppealRow>): AppealRow => ({
    id: 'a',
    name: 'Dinner 2026',
    year: 2026,
    channel: 'dinner',
    total: 41200,
    gift_count: 80,
    prior_id: 'b',
    prior_name: 'Dinner 2025',
    prior_year: 2025,
    prior_total: 36800,
    delta_pct: 12,
    ...patch,
  })

  it('prefers the biggest appeal that has a prior-year twin', () => {
    const highlight = appealHighlight([
      appeal({ id: 'lonely', name: 'Purim 2026', total: 99000, prior_id: null, prior_name: null, delta_pct: null }),
      appeal({}),
    ])
    expect(highlight?.appeal.name).toBe('Dinner 2026')
    expect(highlight?.delta).toBe('▲ 12%')
    expect(highlight?.tone).toBe('good')
  })

  it('falls back to the biggest appeal, and then shows no comparison at all', () => {
    const highlight = appealHighlight([
      appeal({ id: 'x', name: 'Purim 2026', total: 5, prior_id: null, prior_name: null, delta_pct: null }),
      appeal({ id: 'y', name: 'Dinner 2026', total: 900, prior_id: null, prior_name: null, delta_pct: null }),
    ])
    expect(highlight?.appeal.name).toBe('Dinner 2026')
    expect(highlight?.delta).toBeNull()
  })

  it('has nothing to say with no appeals', () => {
    expect(appealHighlight([])).toBeNull()
    expect(appealHighlight(null)).toBeNull()
  })

  it('clamps progress into 0…1', () => {
    expect(progressFraction(57)).toBeCloseTo(0.57, 5)
    expect(progressFraction(140)).toBe(1)
    expect(progressFraction(-4)).toBe(0)
    expect(progressFraction(null)).toBe(0)
  })
})

describe('redaction copy', () => {
  it('says whose problem it is, not that the data is missing', () => {
    expect(AMOUNTS_HIDDEN_NOTE).toBe('Amounts hidden for your role')
  })
})
