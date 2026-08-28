import { useMemo } from 'react'
import { Button, FilterChip, Select } from '../../components'
import { cn } from '../../lib/cn'
import { useLookupOptions } from '../../lib/queries/contacts'
import type { SavedView } from '../../lib/queries/views'
import {
  describeFilters,
  isEmptyFilters,
  withoutKey,
  type FilterKey,
  type ViewFilters,
} from './filterModel'

/* --------------------------------------------------------- filter builder */

export interface AddableFilter {
  id: string
  label: string
  apply: (filters: ViewFilters) => ViewFilters
}

/**
 * The criteria a person can add by hand, inside the typed subset
 * (`filterModel.ts`). Deliberately a short list of *useful* additions rather
 * than a generic query builder — I-6: a solo team configures parameters, not
 * logic, and anything richer than this is a saved view someone writes once.
 */
export function addableFilters(stages: Array<{ value: string; label: string }>): AddableFilter[] {
  return [
    ...stages.map((stage) => ({
      id: `stage:${stage.value}`,
      label: `Stage is ${stage.label}`,
      apply: (filters: ViewFilters): ViewFilters => ({ ...filters, stage: [stage.value] }),
    })),
    {
      id: 'priority:high',
      label: 'High priority',
      apply: (filters) => ({ ...filters, priority: ['high'] }),
    },
    { id: 'tier:A', label: 'Tier A', apply: (filters) => ({ ...filters, tier: ['A'] }) },
    {
      id: 'quiet:30',
      label: 'No contact in 30+ days',
      apply: (filters) => ({ ...filters, days_since_contact_gte: 30 }),
    },
    {
      id: 'quiet:60',
      label: 'No contact in 60+ days',
      apply: (filters) => ({ ...filters, days_since_contact_gte: 60 }),
    },
    {
      id: 'quiet:90',
      label: 'No contact in 90+ days',
      apply: (filters) => ({ ...filters, days_since_contact_gte: 90 }),
    },
    { id: 'lybunt', label: 'LYBUNT (gave last year, not this)', apply: (f) => ({ ...f, is_lybunt: true }) },
    { id: 'sybunt', label: 'SYBUNT (gave some year, not this)', apply: (f) => ({ ...f, is_sybunt: true }) },
    { id: 'gave', label: 'Gave this year', apply: (f) => ({ ...f, gave_this_year: true }) },
    { id: 'pledges', label: 'Pledge balance outstanding', apply: (f) => ({ ...f, pledge_balance_gt: 0 }) },
    {
      id: 'pre_lapsed',
      label: 'Pre-lapsed donors',
      apply: (f) => ({ ...f, donor_status: ['pre_lapsed'] }),
    },
    { id: 'flag:none', label: 'No next action (yellow)', apply: (f) => ({ ...f, flag: 'none' }) },
  ]
}

/* ------------------------------------------------------------------- bar */

export interface ViewsBarProps {
  views: SavedView[]
  activeId: string | null
  filters: ViewFilters
  /** True when the criteria no longer match the active view (or none is active). */
  dirty: boolean
  counts?: Record<string, number | undefined>
  onSelectView: (id: string | null) => void
  onFiltersChange: (filters: ViewFilters) => void
  onSaveAsView: () => void
}

/**
 * The Contacts route's view rail (06 §1): the saved lenses as chips, the
 * active view's criteria as **removable** chips, and "Save as view" the moment
 * those criteria stop matching a saved one.
 *
 * Switching views never mutates data (03 §4) — this component only ever
 * changes which query runs.
 */
export function ViewsBar({
  views,
  activeId,
  filters,
  dirty,
  counts,
  onSelectView,
  onFiltersChange,
  onSaveAsView,
}: ViewsBarProps) {
  const stages = useLookupOptions('stage')
  const priorities = useLookupOptions('priority')

  const chips = useMemo(
    () =>
      describeFilters(filters, {
        stage: Object.fromEntries((stages.data ?? []).map((o) => [o.value, o.label])),
        priority: Object.fromEntries((priorities.data ?? []).map((o) => [o.value, o.label])),
      }),
    [filters, stages.data, priorities.data],
  )

  const additions = useMemo(
    () => addableFilters((stages.data ?? []).map((o) => ({ value: o.value, label: o.label }))),
    [stages.data],
  )

  const contactViews = views.filter((view) => view.entity === 'contacts')

  return (
    <section aria-label="Views" className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-[6px]">
        <FilterChip active={activeId === null && isEmptyFilters(filters)} onClick={() => onSelectView(null)}>
          All contacts
        </FilterChip>
        {contactViews.map((view) => {
          const count = counts?.[view.id]
          return (
            <FilterChip key={view.id} active={activeId === view.id} onClick={() => onSelectView(view.id)}>
              {view.name}
              {count !== undefined ? <span className="ml-[5px] tabular text-faint">{count}</span> : null}
            </FilterChip>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center gap-[6px]">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => onFiltersChange(withoutKey(filters, chip.key as FilterKey))}
            aria-label={`Remove filter ${chip.label}`}
            className={cn(
              'inline-flex items-center gap-[6px] rounded-pill border border-accent bg-accent-soft px-[10px] py-[3px]',
              'text-[12px] text-accent-dark hover:border-accent-dark',
            )}
          >
            {chip.label}
            <span aria-hidden="true" className="text-[13px] leading-none">
              ×
            </span>
          </button>
        ))}

        <div className="w-[190px]">
          <Select
            aria-label="Add a filter"
            value=""
            placeholder="Add filter…"
            options={additions.map((addition) => ({ value: addition.id, label: addition.label }))}
            onChange={(event) => {
              const addition = additions.find((item) => item.id === event.target.value)
              if (addition) onFiltersChange(addition.apply(filters))
            }}
            className="py-[4px] text-[12px]"
          />
        </div>

        {dirty && !isEmptyFilters(filters) ? (
          <Button size="sm" variant="accentOutline" onClick={onSaveAsView} className="ml-auto">
            Save as view
          </Button>
        ) : null}
      </div>
    </section>
  )
}
