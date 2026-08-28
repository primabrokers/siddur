/**
 * The charts on /reports — hand-rolled inline SVG, no charting library
 * (CLAUDE.md: the stack is fixed).
 *
 * House rules, applied here so every card inherits them:
 * - One hue for magnitude (teal), a muted step for a period still in progress,
 *   neutral grey for anything that is a benchmark rather than our own number.
 * - Never two y-axes. Each chart plots one quantity; when amounts are hidden
 *   the quantity becomes gift counts and the axis caption says so.
 * - Thin bars with 4px rounded data-ends anchored to the baseline: a rounded
 *   rect plus a square 4px base rect, the technique in `Reports.dc.html`.
 * - Grid recessive (#EEF1F4), axis text 11px #9AA3AD, all text in ink/muted
 *   tokens — never the series colour. Numbers are tabular.
 * - Every mark carries a `<title>` (hover tooltip) and the chart carries an
 *   `aria-label`; every mark is clickable through to the people behind it.
 */

import type { KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'
import {
  CHART_AXIS_INK,
  CHART_BASELINE,
  CHART_BOX,
  CHART_GRID,
  CHART_NEUTRAL,
  CHART_SERIES,
  type BarLayout,
  type BarMark,
  type BenchmarkBar,
} from './logic'

/* --------------------------------------------------------------- bar chart */

export interface BarChartProps {
  layout: BarLayout
  /** Describes the whole chart for assistive tech (chart rules). */
  ariaLabel: string
  /** Callout above the tallest bar — "£34,944 · Mar". */
  peakLabel?: string | null
  /** Click-through: "…and here are the people" (06 §3). */
  onSelect?: (mark: BarMark) => void
  className?: string
}

export function BarChart({ layout, ariaLabel, peakLabel, onSelect, className }: BarChartProps) {
  const { radius } = CHART_BOX
  const activate = (mark: BarMark) => () => onSelect?.(mark)
  const onKeyDown = (mark: BarMark) => (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect?.(mark)
  }

  return (
    <svg
      viewBox={layout.viewBox}
      role="img"
      aria-label={ariaLabel}
      // Width from the card, height from the viewBox's aspect ratio — so the
      // 4px data-ends stay round instead of being stretched by
      // `preserveAspectRatio="none"`. No `height` attribute: SVG wants a length,
      // and "auto" belongs in CSS.
      style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
      className={cn('block h-auto w-full overflow-visible', className)}
      data-testid="giving-bar-chart"
    >
      {layout.gridY.map((y) => (
        <line key={y} x1="0" y1={y} x2={layout.width} y2={y} stroke={CHART_GRID} strokeWidth="1" />
      ))}
      <line
        x1="0"
        y1={layout.baseline}
        x2={layout.width}
        y2={layout.baseline}
        stroke={CHART_BASELINE}
        strokeWidth="1"
      />

      {layout.marks.map((mark) => (
        <g
          key={mark.key}
          data-testid="bar-mark"
          data-bucket={mark.key}
          data-peak={mark.isPeak ? 'true' : undefined}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-label={`${mark.label} — ${mark.detail}. Show the donors.`}
          onClick={onSelect ? activate(mark) : undefined}
          onKeyDown={onSelect ? onKeyDown(mark) : undefined}
          className={onSelect ? 'cursor-pointer focus:outline-none' : undefined}
        >
          <title>{`${mark.label} — ${mark.detail}`}</title>
          {/* A generous transparent target, so a 4px sliver is still clickable. */}
          <rect
            x={mark.x - 6}
            y={CHART_BOX.top - 12}
            width={mark.width + 12}
            height={layout.baseline - CHART_BOX.top + 12}
            fill="transparent"
          />
          {mark.height > 0 ? (
            <>
              {/* rounded data-end… */}
              <rect x={mark.x} y={mark.y} width={mark.width} height={mark.height} rx={radius} fill={mark.fill} />
              {/* …squared off against the baseline */}
              <rect x={mark.x} y={mark.baseY} width={mark.width} height={radius} fill={mark.fill} />
            </>
          ) : null}
          <text
            x={mark.x + mark.width / 2}
            y={layout.axisY}
            textAnchor="middle"
            fontSize="11"
            fill={CHART_AXIS_INK}
            className="tabular"
          >
            {mark.label}
          </text>
        </g>
      ))}

      {peakLabel && layout.peak ? (
        <text
          x={Math.min(
            Math.max(layout.peak.x + layout.peak.width / 2, 46),
            layout.width - 46,
          )}
          y={13}
          textAnchor="middle"
          fontSize="11"
          fill="#4B5563"
          className="tabular"
          data-testid="peak-label"
        >
          {peakLabel}
        </text>
      ) : null}
    </svg>
  )
}

/* -------------------------------------------------------- benchmark bar rows */

export interface BenchmarkBarsProps {
  bars: BenchmarkBar[]
  /** Sentence describing the group for assistive tech. */
  ariaLabel: string
  /** Rendered under the rows — "Benchmarks: FEP 2026". */
  footnote?: string | null
  className?: string
}

/**
 * You / sector / 7+ year donors. HTML rather than SVG on purpose: these are
 * three labelled meters, not a plotted series, and `Reports.dc.html` draws them
 * exactly this way — 130px label, 12px track, right-aligned tabular value.
 */
export function BenchmarkBars({ bars, ariaLabel, footnote, className }: BenchmarkBarsProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)} role="group" aria-label={ariaLabel}>
      {bars.map((bar) => (
        <div
          key={bar.id}
          className="flex items-center gap-[10px] text-[12px] text-nav"
          data-testid="benchmark-bar"
          data-benchmark={bar.isBenchmark ? 'true' : 'false'}
          title={bar.title}
        >
          <span className="w-[92px] shrink-0 sm:w-[130px]">{bar.label}</span>
          <div
            className="h-[12px] grow overflow-hidden rounded-[6px] bg-row"
            role="img"
            aria-label={bar.title}
          >
            <div
              className="h-[12px] rounded-r-[6px]"
              style={{ width: `${bar.width}%`, background: bar.fill }}
            />
          </div>
          <span className="tabular w-[38px] shrink-0 text-right">
            {bar.value === null ? '—' : `${Math.round(bar.value * 10) / 10}%`}
          </span>
        </div>
      ))}
      {footnote ? <p className="text-[11px] text-faint">{footnote}</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------ progress ring */

export interface ProgressRingProps {
  /** 0…1. */
  value: number
  /** Big number in the middle — "6.9%". */
  headline: string
  /** Small line under it — "£138,556 of £2,000,000". */
  caption?: string | null
  ariaLabel: string
  size?: number
  className?: string
}

/** The campaign page's progress ring (05 §4 ▸ Beacon's progress card). */
export function ProgressRing({
  value,
  headline,
  caption,
  ariaLabel,
  size = 132,
  className,
}: ProgressRingProps) {
  const stroke = 12
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))

  return (
    <div className={cn('flex items-center gap-4', className)}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={ariaLabel}
        data-testid="progress-ring"
      >
        <title>{ariaLabel}</title>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={CHART_GRID}
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={clamped > 0 ? CHART_SERIES : CHART_NEUTRAL}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circumference * clamped} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="flex flex-col gap-1">
        <span className="tabular text-[28px] leading-none font-bold">{headline}</span>
        {caption ? <span className="tabular text-[12.5px] text-muted">{caption}</span> : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- shared chrome */

export interface ReportCardProps {
  title: string
  /** Right-hand slot on the card header — a link, a total, a hint. */
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}

/** The white 12px-radius card every report sits in (`Reports.dc.html`). */
export function ReportCard({ title, action, children, className }: ReportCardProps) {
  return (
    <section
      className={cn(
        'flex flex-col gap-[14px] rounded-card-lg border border-border bg-surface px-5 py-[18px]',
        className,
      )}
      aria-label={title}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold tracking-[0.05em] text-muted uppercase">{title}</h2>
        {action ? <div className="text-[12px]">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

export interface DrillNumberProps {
  /** The figure itself — already formatted. */
  value: React.ReactNode
  /** What the figure counts, e.g. "Lapsed". */
  label: React.ReactNode
  onClick: () => void
  tone?: 'ink' | 'bad' | 'gold'
  /** Full sentence for the tooltip and the accessible name. */
  title: string
  className?: string
}

/**
 * A number that opens the people behind it. 06 §3 makes this the rule rather
 * than the exception, so it is one component: same affordance, same hover
 * tooltip, same accessible name everywhere on the screen.
 */
export function DrillNumber({ value, label, onClick, tone = 'ink', title, className }: DrillNumberProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      data-testid="drill-number"
      className={cn(
        'tabular group inline-flex items-baseline gap-[5px] rounded-[6px] px-[3px] text-left text-[12.5px] transition-colors',
        tone === 'bad' ? 'text-flag-overdue' : 'text-nav',
        'hover:bg-accent-soft hover:text-accent-dark',
        className,
      )}
    >
      <span>{label}</span>
      <b className={cn('font-bold', tone === 'gold' && 'text-gold')}>{value}</b>
    </button>
  )
}

/** "Not enough history yet" — the explicit empty state the chart rules demand. */
export function ChartEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-card border border-dashed border-border px-4 py-6 text-center text-[12.5px] text-muted"
      data-testid="chart-empty"
    >
      {children}
    </p>
  )
}
