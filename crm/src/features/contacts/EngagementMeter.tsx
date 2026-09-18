import { cn } from '../../lib/cn'
import { ENGAGEMENT_LABEL, ENGAGEMENT_SEGMENTS } from './stats'
import type { EngagementTier } from './types'

export interface EngagementMeterProps {
  tier: EngagementTier | null | undefined
  className?: string
}

/**
 * The computed engagement meter (04 §5.1): five segments Cold→On Fire with the
 * tier named. Outlined and read-only because it is arithmetic, not judgement
 * (I-7); `unknown` says "Not enough history yet" rather than faking a score
 * (▸ DonorSearch DS3 honesty).
 */
export function EngagementMeter({ tier, className }: EngagementMeterProps) {
  const resolved: EngagementTier = tier ?? 'unknown'
  const filled = ENGAGEMENT_SEGMENTS[resolved]
  const label = ENGAGEMENT_LABEL[resolved]

  if (resolved === 'unknown') {
    return (
      <span
        data-testid="engagement-meter"
        data-tier="unknown"
        title="Computed — read-only"
        className={cn(
          'inline-flex items-center gap-1 rounded-pill border border-chip-border px-[10px] py-[2px] text-[11.5px] font-semibold text-muted',
          className,
        )}
      >
        {label}
      </span>
    )
  }

  return (
    <span
      data-testid="engagement-meter"
      data-tier={resolved}
      title="Computed — read-only"
      aria-label={`Engagement: ${label}`}
      className={cn(
        'inline-flex items-center gap-[5px] rounded-pill border-[1.5px] border-faint px-[10px] py-[2px] text-[11.5px] font-semibold text-nav',
        className,
      )}
    >
      <span aria-hidden="true" className="flex gap-[2px]">
        {[0, 1, 2, 3, 4].map((index) => (
          <span
            key={index}
            className={cn('h-[10px] w-[7px] rounded-[2px]', index < filled ? 'bg-accent' : 'bg-border')}
          />
        ))}
      </span>
      {label}
    </span>
  )
}
