/**
 * Presentation arithmetic for the Reports screen — and nothing else.
 *
 * The database owns every *number* (I-8): retention rate, YoY delta, quintile
 * segment counts and campaign percentages all arrive from `report_overview`
 * already computed. What lives here is the geometry and wording that turns
 * those numbers into marks on a chart: bar rectangles, benchmark bar widths,
 * movement arrows, the peak label. Pure functions, no React, no fetching —
 * so `tests/reports-logic.test.ts` can pin the edges.
 *
 * Chart palette (single hue, magnitude only):
 *   series  #0E6E6B  the measured quantity
 *   muted   #8FBFBC  a partial/in-progress step (the current month)
 *   neutral #B9C2CA  a benchmark — never our own number
 *   grid    #EEF1F4  recessive
 *   axis    #9AA3AD  11px labels
 * Text never takes a series colour; ink/muted tokens only.
 */

import { formatMoney, formatNumber } from '../../lib/format'
import type {
  AppealRow,
  GivingBucket,
  GivingSummary,
  ReportScope,
  RetentionSummary,
  RfmSegment,
} from './types'

/* ------------------------------------------------------------------ palette */

export const CHART_SERIES = '#0E6E6B'
export const CHART_STEP = '#8FBFBC'
export const CHART_NEUTRAL = '#B9C2CA'
export const CHART_GRID = '#EEF1F4'
export const CHART_BASELINE = '#E3E6EA'
export const CHART_AXIS_INK = '#9AA3AD'

/** Shown wherever a money figure would have been, for a restricted viewer. */
export const AMOUNTS_HIDDEN_NOTE = 'Amounts hidden for your role'

/* -------------------------------------------------------------------- scope */

/** The header toggle → the `p_year` the RPCs take. `null` = all time. */
export function scopeToYear(scope: ReportScope, today: Date = new Date()): number | null {
  const year = today.getFullYear()
  if (scope === 'this_year') return year
  if (scope === 'last_year') return year - 1
  return null
}

export function scopeLabel(scope: ReportScope, today: Date = new Date()): string {
  const year = today.getFullYear()
  if (scope === 'this_year') return String(year)
  if (scope === 'last_year') return String(year - 1)
  return 'All time'
}

/* ------------------------------------------------------------------- deltas */

export type DeltaTone = 'good' | 'bad' | 'muted'

/**
 * `▲ 3 pts vs last year`. A null delta (no prior-prior year to compare) prints
 * nothing rather than a fake zero — the card just shows the headline.
 */
export function formatDeltaPoints(delta: number | null | undefined): string | null {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return null
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return 'level with last year'
  const arrow = rounded > 0 ? '▲' : '▼'
  return `${arrow} ${Math.abs(rounded)} pts vs last year`
}

export function deltaTone(delta: number | null | undefined): DeltaTone {
  if (delta === null || delta === undefined || Number.isNaN(delta) || delta === 0) return 'muted'
  return delta > 0 ? 'good' : 'bad'
}

/** `▲ 12%` for the appeal's year-on-year line. */
export function formatDeltaPercent(delta: number | null | undefined): string | null {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return null
  const rounded = Math.round(delta * 10) / 10
  if (rounded === 0) return 'level'
  return `${rounded > 0 ? '▲' : '▼'} ${Math.abs(rounded)}%`
}

/** `61%` — the SQL already rounded to 1dp; this only formats. */
export function formatPercent(value: number | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
}

/* ---------------------------------------------------------------- retention */

export interface BenchmarkBar {
  id: string
  label: string
  value: number | null
  /** 0…100, clamped — the track is a percentage. */
  width: number
  /** Our own number takes the series hue; a benchmark stays neutral. */
  fill: string
  /** True for the rows sourced from the sector table, not from our ledger. */
  isBenchmark: boolean
  title: string
}

/**
 * You · sector average · 7+ year donors (06 §3 — "sector benchmarks shown
 * beside own numbers"). Both benchmark rows render neutral: they come from the
 * `benchmarks` rule (FEP), not from this charity's ledger, and colouring them
 * like our bar would claim them as ours.
 */
export function benchmarkBars(retention: RetentionSummary | null | undefined): BenchmarkBar[] {
  const source = retention?.benchmark_source ?? 'sector'
  const year = retention?.benchmark_year
  const suffix = year ? ` (${source} ${year})` : ` (${source})`
  const clamp = (value: number | null | undefined): number =>
    value === null || value === undefined || Number.isNaN(value) ? 0 : Math.max(0, Math.min(100, value))

  return [
    {
      id: 'you',
      label: 'You',
      value: retention?.rate ?? null,
      width: clamp(retention?.rate),
      fill: CHART_SERIES,
      isBenchmark: false,
      title: `Your donor retention: ${formatPercent(retention?.rate ?? null)}`,
    },
    {
      id: 'sector',
      label: 'Sector average',
      value: retention?.benchmark_overall ?? null,
      width: clamp(retention?.benchmark_overall),
      fill: CHART_NEUTRAL,
      isBenchmark: true,
      title: `Sector average retention ${formatPercent(retention?.benchmark_overall ?? null)}${suffix}`,
    },
    {
      id: 'seven_plus',
      label: '7+ year donors',
      value: retention?.benchmark_7plus ?? null,
      width: clamp(retention?.benchmark_7plus),
      fill: CHART_NEUTRAL,
      isBenchmark: true,
      title: `Donors of 7+ years retain at ${formatPercent(retention?.benchmark_7plus ?? null)}${suffix}`,
    },
  ]
}

export interface RetentionCount {
  id: string
  label: string
  value: number
  /** `report_drill` key behind the number. */
  drill: 'retention_new' | 'retention_repeat' | 'retention_reactivated' | 'retention_lapsed'
  tone: 'ink' | 'bad'
}

/**
 * New · Repeat · Reactivated · Lapsed. The first three partition this year's
 * donors (a donor is new, or gave last year too, or came back after a gap);
 * lapsed counts last year's donors who have not given this year, so it sits
 * outside the partition and reads red.
 */
export function retentionCounts(retention: RetentionSummary | null | undefined): RetentionCount[] {
  return [
    { id: 'new', label: 'New donors', value: retention?.new_donors ?? 0, drill: 'retention_new', tone: 'ink' },
    { id: 'repeat', label: 'Repeat', value: retention?.repeat_donors ?? 0, drill: 'retention_repeat', tone: 'ink' },
    {
      id: 'reactivated',
      label: 'Reactivated',
      value: retention?.reactivated ?? 0,
      drill: 'retention_reactivated',
      tone: 'ink',
    },
    { id: 'lapsed', label: 'Lapsed', value: retention?.lapsed ?? 0, drill: 'retention_lapsed', tone: 'bad' },
  ]
}

/**
 * The three cohorts must add up to this year's donor count. They come from the
 * same SQL row, so a mismatch means the payload is stale or partial — the card
 * uses this to keep quiet rather than print a total that does not reconcile.
 */
export function countsReconcile(retention: RetentionSummary | null | undefined): boolean {
  if (!retention) return false
  return (
    retention.new_donors + retention.repeat_donors + retention.reactivated === retention.current_donors
  )
}

/* -------------------------------------------------------------- bar geometry */

/** The wireframe's chart box: 640×172, baseline at 150, 20px of headroom. */
export const CHART_BOX = {
  width: 640,
  height: 172,
  baseline: 150,
  top: 20,
  /** Where the month/year labels sit. */
  axisY: 166,
  /** Widest a bar gets — thin bars, per the chart rules. */
  maxBarWidth: 30,
  /** The rounded data-end radius, and the height of the square base rect. */
  radius: 4,
} as const

export interface BarPoint {
  key: string
  label: string
  value: number
  /** Tooltip body — already formatted, so the chart stays presentation-free. */
  detail: string
  isCurrent: boolean
}

export interface BarMark extends BarPoint {
  x: number
  y: number
  width: number
  height: number
  /** Top of the 4px square that squares the rounded rect off at the baseline. */
  baseY: number
  isPeak: boolean
  fill: string
}

export interface BarLayout {
  marks: BarMark[]
  gridY: number[]
  baseline: number
  axisY: number
  viewBox: string
  width: number
  height: number
  max: number
  peak: BarMark | null
}

const round = (value: number): number => Math.round(value * 100) / 100

/**
 * Lay bars out inside `CHART_BOX`. Each mark is drawn as a rounded rect plus a
 * square 4px base rect, so the data-end is rounded and the bar still sits flat
 * on the baseline (the technique in `wireframes/Reports.dc.html`).
 *
 * A non-zero value never renders shorter than the radius: a £40 month must be
 * a visible sliver, not an invisible one.
 */
export function layoutBars(points: BarPoint[]): BarLayout {
  const { width, height, baseline, top, axisY, maxBarWidth, radius } = CHART_BOX
  const plot = baseline - top
  const max = points.reduce((best, point) => Math.max(best, point.value), 0)
  const peakValue = max
  let peakSeen = false

  const slot = points.length > 0 ? width / points.length : width
  const barWidth = round(Math.min(maxBarWidth, slot * 0.42))

  const marks: BarMark[] = points.map((point, index) => {
    const raw = max > 0 ? (point.value / max) * plot : 0
    const barHeight = point.value > 0 ? round(Math.max(radius, raw)) : 0
    // Exactly one bar wears the peak label, even when two months tie.
    const isPeak = !peakSeen && point.value > 0 && point.value === peakValue
    if (isPeak) peakSeen = true
    return {
      ...point,
      x: round(slot * index + (slot - barWidth) / 2),
      y: round(baseline - barHeight),
      width: barWidth,
      height: barHeight,
      baseY: round(baseline - radius),
      isPeak,
      fill: point.isCurrent ? CHART_STEP : CHART_SERIES,
    }
  })

  return {
    marks,
    gridY: [round(baseline - plot / 3), round(baseline - (plot * 2) / 3)],
    baseline,
    axisY,
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    max,
    peak: marks.find((mark) => mark.isPeak) ?? null,
  }
}

/**
 * Buckets → bar points. With amounts hidden the chart plots gift *counts*
 * instead of money — the shape of the year is still worth seeing, and the axis
 * label says which quantity is on it (11 §2).
 */
export function givingBarPoints(
  giving: GivingSummary | null | undefined,
  amountsHidden: boolean,
): BarPoint[] {
  const buckets: GivingBucket[] = giving?.buckets ?? []
  return buckets.map((bucket) => ({
    key: bucket.bucket_key,
    label: bucket.label,
    value: amountsHidden ? bucket.gift_count : (bucket.total ?? 0),
    detail: amountsHidden
      ? `${formatNumber(bucket.gift_count)} gifts · ${formatNumber(bucket.donor_count)} donors`
      : `${formatMoney(bucket.total)} · ${formatNumber(bucket.gift_count)} gifts`,
    isCurrent: bucket.is_current,
  }))
}

/**
 * A chart with one bar, or with nothing but zeros, is a chart that lies about
 * having a trend. 06 §3's reports are decisions, not decoration — say so.
 */
export function hasEnoughHistory(points: BarPoint[]): boolean {
  return points.length >= 2 && points.some((point) => point.value > 0)
}

/** `£52k · Mar` — the peak callout above the tallest bar. */
export function peakLabel(layout: BarLayout, amountsHidden: boolean): string | null {
  const peak = layout.peak
  if (!peak || peak.value <= 0) return null
  return amountsHidden
    ? `${formatNumber(peak.value)} gifts · ${peak.label}`
    : `${formatMoney(peak.value)} · ${peak.label}`
}

/* ---------------------------------------------------------------------- RFM */

export type MovementTone = 'good' | 'alert' | 'muted'

export interface SegmentMovement {
  text: string
  tone: MovementTone
  delta: number | null
}

/** The line under each persona count when the segment has not moved. */
const SEGMENT_DESCRIPTOR: Record<string, string> = {
  Champions: 'your best relationships',
  Loyal: 'steady',
  'New & Promising': 'worth a second ask',
  'At-Risk': 'act now',
  "Can't Lose Them": 'high value, gone quiet',
  'Small & Steady': 'the community base',
}

/**
 * Movement since the previous recompute (06 §3). `previous` is null until
 * `run_rfm()` has run twice, and the tile then shows its descriptor rather than
 * inventing a delta against zero.
 *
 * Direction reads differently per tile: more Champions is good news, more
 * At-Risk is not — so an alert segment growing stays red and shrinking goes
 * green.
 */
export function segmentMovement(segment: RfmSegment): SegmentMovement {
  const descriptor = SEGMENT_DESCRIPTOR[segment.segment] ?? 'steady'
  if (segment.previous === null || segment.previous === undefined) {
    return { text: descriptor, tone: segment.is_alert ? 'alert' : 'muted', delta: null }
  }
  const delta = segment.headcount - segment.previous
  if (delta === 0) return { text: descriptor, tone: segment.is_alert ? 'alert' : 'muted', delta: 0 }

  const arrow = delta > 0 ? '▲' : '▼'
  const grew = delta > 0
  const tone: MovementTone = segment.is_alert ? (grew ? 'alert' : 'good') : grew ? 'good' : 'muted'
  const suffix = segment.is_alert && grew ? ` — ${descriptor}` : ''
  return { text: `${arrow} ${Math.abs(delta)}${suffix}`, tone, delta }
}

/**
 * `run_rfm()` refuses to segment fewer than five donors (quintiles over four
 * donors are theatre), and leaves the tags untouched — so the card shows its
 * empty state rather than six zeros.
 */
export function rfmHasSegmentation(
  segments: RfmSegment[],
  computedAt: string | null | undefined,
): boolean {
  if (!computedAt) return false
  return segments.some((segment) => segment.headcount > 0)
}

/* ----------------------------------------------------------------- campaigns */

export interface AppealHighlight {
  appeal: AppealRow
  delta: string | null
  tone: DeltaTone
}

/**
 * The card's footer line — "Dinner 2026 £41,200 vs Dinner 2025 £36,800 ▲ 12%".
 * Prefers the biggest appeal that actually has a prior-year twin; falls back to
 * the biggest appeal, which then shows no comparison rather than a fabricated
 * one.
 */
export function appealHighlight(appeals: AppealRow[] | null | undefined): AppealHighlight | null {
  const list = appeals ?? []
  if (list.length === 0) return null
  const withPrior = list.filter((appeal) => appeal.prior_id !== null)
  const pick = (withPrior.length > 0 ? withPrior : list).reduce((best, appeal) =>
    (appeal.total ?? 0) > (best.total ?? 0) ? appeal : best,
  )
  return {
    appeal: pick,
    delta: formatDeltaPercent(pick.delta_pct),
    tone: deltaTone(pick.delta_pct),
  }
}

/** 0…1 for a progress bar or ring; a missing goal yields 0, never NaN. */
export function progressFraction(pct: number | null | undefined): number {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return 0
  return Math.max(0, Math.min(1, pct / 100))
}
