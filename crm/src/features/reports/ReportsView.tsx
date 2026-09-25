/**
 * Reports — artboard A8, spec 06 §3.
 *
 * "Decisions, not statistics" (brief §31): every card answers one question and
 * every number on it opens the people behind it. One RPC (`report_overview`)
 * serves the whole gallery, so the period toggle in the header re-scopes all
 * six cards at once with a single round trip.
 *
 * Amount redaction is the database's answer (11 §2): a member without
 * `can_see_amounts` gets the same payload with money nulled and
 * `amounts_hidden` set, and the cards fall back to counts with the reason said
 * out loud rather than showing zeros.
 */

import { useState } from 'react'
import { FilterChip } from '../../components'
import { PageHeader } from '../shell/PageHeader'
import { isConfigured } from '../../lib/env'
import { useReportOverview } from '../../lib/queries/reports'
import { ActivityCard } from './ActivityCard'
import { CampaignsCard } from './CampaignsCard'
import { DrillSheet } from './DrillSheet'
import { GiftAidCard } from './GiftAidCard'
import { GivingCard } from './GivingCard'
import { RetentionCard } from './RetentionCard'
import { RfmCard } from './RfmCard'
import { AMOUNTS_HIDDEN_NOTE, scopeLabel, scopeToYear } from './logic'
import type { DrillTarget, ReportScope } from './types'

const SCOPES: Array<{ id: ReportScope; label: string }> = [
  { id: 'this_year', label: 'This year' },
  { id: 'last_year', label: 'Last year' },
  { id: 'all_time', label: 'All time' },
]

export function ReportsView() {
  const [scope, setScope] = useState<ReportScope>('this_year')
  const [drill, setDrill] = useState<DrillTarget | null>(null)
  const year = scopeToYear(scope)
  const overview = useReportOverview(year)
  const data = overview.data

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="every number opens the people behind it"
        actions={
          <div className="flex flex-wrap gap-[6px]" role="group" aria-label="Reporting period">
            {SCOPES.map((item) => (
              <FilterChip
                key={item.id}
                active={scope === item.id}
                onClick={() => setScope(item.id)}
              >
                {item.label}
              </FilterChip>
            ))}
          </div>
        }
      />

      {!isConfigured ? (
        <p className="rounded-card border border-border bg-surface px-4 py-6 text-[13px] text-muted">
          Not connected to a project yet — reports read live aggregates from Postgres.
        </p>
      ) : overview.isPending ? (
        <p className="rounded-card border border-border bg-surface px-4 py-6 text-[13px] text-muted">
          Building the figures…
        </p>
      ) : overview.isError || !data ? (
        <p className="rounded-card border border-border bg-surface px-4 py-6 text-[13px] text-flag-overdue">
          {(overview.error as Error)?.message ?? 'Could not load the reports.'}
        </p>
      ) : (
        <>
          {data.amounts_hidden ? (
            <p
              className="mb-3 rounded-card border border-border bg-accent-soft px-3 py-2 text-[12.5px] text-accent-dark"
              data-testid="amounts-hidden-note"
            >
              {AMOUNTS_HIDDEN_NOTE} — the counts below are complete; the money is not shown.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <RetentionCard retention={data.retention} onDrill={setDrill} />
            <GivingCard
              giving={data.giving}
              granularity={data.granularity}
              periodLabel={scopeLabel(scope)}
              amountsHidden={data.amounts_hidden}
              onDrill={setDrill}
            />
            <RfmCard rfm={data.rfm} onDrill={setDrill} />
            <CampaignsCard
              campaigns={data.campaigns}
              appeals={data.appeals}
              amountsHidden={data.amounts_hidden}
              onDrill={setDrill}
            />
            <ActivityCard
              activity={data.activity}
              amountsHidden={data.amounts_hidden}
              year={year}
              onDrill={setDrill}
            />
            <GiftAidCard
              giftAid={data.gift_aid}
              amountsHidden={data.amounts_hidden}
              onDrill={setDrill}
            />
          </div>

          <p className="mt-3 text-[11px] text-faint">
            Every figure is a grouped query against the ledger, not a stored total — generated{' '}
            {data.generated_at}.
          </p>
        </>
      )}

      <DrillSheet
        target={drill}
        year={year}
        amountsHidden={data?.amounts_hidden ?? false}
        onClose={() => setDrill(null)}
      />
    </>
  )
}
