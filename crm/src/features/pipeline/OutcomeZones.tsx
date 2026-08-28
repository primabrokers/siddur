import type { DragEvent } from 'react'
import { cn } from '../../lib/cn'
import type { OpportunityStatus } from './types'

export type OutcomeZone = Extract<OpportunityStatus, 'won' | 'lost' | 'on_hold'>

interface ZoneSpec {
  id: OutcomeZone
  label: string
  className: string
  hover: string
  grow: boolean
}

/** Exact colours from `wireframes/Pipeline.dc.html` — the drop-zone strip. */
const ZONES: ZoneSpec[] = [
  {
    id: 'won',
    label: 'Drag here — WON → record gift or pledge',
    className: 'border-[#7FBF9A] bg-[#EDF7F1] text-good grow',
    hover: 'bg-[#DCEFE3] shadow-[inset_0_0_0_1px_#7FBF9A]',
    grow: true,
  },
  {
    id: 'lost',
    label: 'LOST → record reason',
    className: 'border-[#D8A0A0] bg-[#FBF0F0] text-[#B03030] grow',
    hover: 'bg-[#F6E2E2] shadow-[inset_0_0_0_1px_#D8A0A0]',
    grow: true,
  },
  {
    id: 'on_hold',
    label: 'ON HOLD',
    className: 'w-[220px] border-[#C9D0D8] bg-[#F1F3F6] text-muted',
    hover: 'bg-[#E6EAEF] shadow-[inset_0_0_0_1px_#C9D0D8]',
    grow: false,
  },
]

export interface OutcomeZonesProps {
  /** The strip only exists while a card is in flight (▸ Pipedrive). */
  visible: boolean
  over: OutcomeZone | null
  onDragOver: (zone: OutcomeZone, event: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (zone: OutcomeZone, event: DragEvent<HTMLDivElement>) => void
}

/**
 * Won · Lost · On hold, revealed on drag (06 §2 ▸ Pipedrive). Won prompts for
 * the gift or pledge (05), Lost asks for the reason the conversion report
 * groups by (06 §3), On hold just parks the ask without closing it.
 */
export function OutcomeZones({ visible, over, onDragOver, onDragLeave, onDrop }: OutcomeZonesProps) {
  if (!visible) return null

  return (
    <div className="dc-fade-enter flex gap-3 pt-3" aria-label="Outcome drop zones" role="group">
      {ZONES.map((zone) => (
        <div
          key={zone.id}
          data-testid={`outcome-dropzone-${zone.id}`}
          onDragOver={(event) => onDragOver(zone.id, event)}
          onDragLeave={onDragLeave}
          onDrop={(event) => onDrop(zone.id, event)}
          className={cn(
            'rounded-card border-[1.5px] border-dashed py-[10px] text-center text-[12.5px] font-bold transition-colors',
            zone.className,
            over === zone.id && zone.hover,
          )}
        >
          {zone.label}
        </div>
      ))}
    </div>
  )
}
