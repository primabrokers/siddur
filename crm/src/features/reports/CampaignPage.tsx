/**
 * One campaign — spec 05 §4.
 *
 * "Per-campaign page: progress ring vs goal (▸ Beacon), gifts table, pledges
 * outstanding, top gifts, per-appeal breakdown ('Dinner letter £41k · email
 * £6k')." One RPC (`report_campaign_detail`) returns all five, already grouped
 * by Postgres (I-8), already redacted for a viewer without `can_see_amounts`.
 */

import { Link, useParams } from 'react-router'
import { PageHeader } from '../shell/PageHeader'
import { isConfigured } from '../../lib/env'
import { formatDate, formatMoney, formatNumber } from '../../lib/format'
import { useCampaignDetail } from '../../lib/queries/reports'
import { ChartEmpty, ProgressRing, ReportCard } from './charts'
import { AMOUNTS_HIDDEN_NOTE, formatPercent, progressFraction } from './logic'

export function CampaignPage() {
  const { id } = useParams<{ id: string }>()
  const detail = useCampaignDetail(id)
  const data = detail.data
  const campaign = data?.campaign ?? null
  const progress = data?.progress ?? null
  const hidden = data?.amounts_hidden ?? false

  const back = (
    <Link to="/reports" className="text-[13px] font-semibold text-accent hover:text-accent-dark">
      ← Reports
    </Link>
  )

  if (!isConfigured) {
    return (
      <>
        <PageHeader title="Campaign" actions={back} />
        <p className="rounded-card border border-border bg-surface px-4 py-6 text-[13px] text-muted">
          Not connected to a project yet.
        </p>
      </>
    )
  }

  if (detail.isPending) {
    return (
      <>
        <PageHeader title="Campaign" actions={back} />
        <p className="rounded-card border border-border bg-surface px-4 py-6 text-[13px] text-muted">
          Loading the campaign…
        </p>
      </>
    )
  }

  if (detail.isError || !campaign) {
    return (
      <>
        <PageHeader title="Campaign" actions={back} />
        <p className="rounded-card border border-border bg-surface px-4 py-6 text-[13px] text-flag-overdue">
          {(detail.error as Error)?.message ?? 'That campaign could not be found.'}
        </p>
      </>
    )
  }

  const window = [campaign.starts_on, campaign.ends_on].filter(Boolean).map((d) => formatDate(d))
  const gifts = data?.gifts ?? []
  const topGifts = data?.top_gifts ?? []
  const pledges = data?.pledges ?? []
  const appeals = data?.appeals ?? []

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={
          <>
            {campaign.is_active ? 'Active campaign' : 'Closed campaign'}
            {window.length > 0 ? ` · ${window.join(' – ')}` : null}
            {campaign.description ? ` · ${campaign.description}` : null}
          </>
        }
        actions={back}
      />

      {hidden ? (
        <p
          className="mb-3 rounded-card border border-border bg-accent-soft px-3 py-2 text-[12.5px] text-accent-dark"
          data-testid="amounts-hidden-note"
        >
          {AMOUNTS_HIDDEN_NOTE} — gift and pledge counts are complete; the money is not shown.
        </p>
      ) : null}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <ReportCard title="Progress against goal">
          <ProgressRing
            value={progressFraction(progress?.pct)}
            headline={formatPercent(progress?.pct ?? null, '—')}
            caption={
              hidden
                ? `${formatNumber(progress?.gift_count ?? 0)} gifts from ${formatNumber(progress?.donor_count ?? 0)} donors`
                : `${formatMoney(progress?.raised ?? null)} of ${formatMoney(campaign.goal)}`
            }
            ariaLabel={`${campaign.name}: ${formatPercent(progress?.pct ?? null, 'no goal set')} of goal, ${formatNumber(progress?.gift_count ?? 0)} gifts from ${formatNumber(progress?.donor_count ?? 0)} donors`}
          />
          <div className="tabular flex flex-wrap gap-x-5 gap-y-1 border-t border-row pt-[10px] text-[12.5px] text-nav">
            <span>
              Gifts <b>{formatNumber(progress?.gift_count ?? 0)}</b>
            </span>
            <span>
              Donors <b>{formatNumber(progress?.donor_count ?? 0)}</b>
            </span>
            {hidden ? null : (
              <span>
                Pledged, unpaid{' '}
                <b className="text-gold">{formatMoney(progress?.pledged_outstanding ?? 0)}</b>
              </span>
            )}
          </div>
        </ReportCard>

        <ReportCard
          title="Per-appeal breakdown"
          action={<span className="text-[12px] text-faint">{formatNumber(appeals.length)} appeals</span>}
        >
          {appeals.length === 0 ? (
            <ChartEmpty>No appeals coded to this campaign yet.</ChartEmpty>
          ) : (
            <ul className="tabular flex flex-col divide-y divide-row text-[12.5px]">
              {appeals.map((appeal) => (
                <li key={appeal.id} className="flex items-baseline justify-between gap-3 py-[7px]">
                  <span className="min-w-0 truncate">
                    <b className="text-ink">{appeal.name}</b>
                    {appeal.channel ? <span className="text-muted"> · {appeal.channel}</span> : null}
                  </span>
                  <span className="shrink-0 text-right text-nav">
                    {hidden ? (
                      <b>{formatNumber(appeal.gift_count)} gifts</b>
                    ) : (
                      <>
                        <b className="text-gold">{formatMoney(appeal.total)}</b>
                        <span className="text-faint"> · {formatNumber(appeal.gift_count)} gifts</span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>

        <ReportCard title="Top gifts">
          {topGifts.length === 0 ? (
            <ChartEmpty>No gifts recorded against this campaign yet.</ChartEmpty>
          ) : (
            <ul className="tabular flex flex-col divide-y divide-row text-[12.5px]">
              {topGifts.map((gift) => (
                <li key={gift.id} className="flex items-baseline justify-between gap-3 py-[7px]">
                  <Link
                    to={`/contacts/${gift.contact_id}`}
                    className="min-w-0 truncate font-semibold text-ink hover:text-accent-dark"
                  >
                    {gift.contact_name}
                  </Link>
                  <span className="shrink-0 text-right">
                    {hidden ? (
                      <span className="text-muted">{formatDate(gift.donated_on)}</span>
                    ) : (
                      <>
                        <b className="text-gold">{formatMoney(gift.amount)}</b>
                        <span className="text-faint"> · {formatDate(gift.donated_on)}</span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>

        <ReportCard
          title="Pledges outstanding"
          action={<span className="text-[12px] text-faint">{formatNumber(pledges.length)} open</span>}
        >
          {pledges.length === 0 ? (
            <ChartEmpty>Nothing promised and unpaid — every pledge on this campaign is settled.</ChartEmpty>
          ) : (
            <ul className="tabular flex flex-col divide-y divide-row text-[12.5px]">
              {pledges.map((pledge) => (
                <li key={pledge.id} className="flex items-baseline justify-between gap-3 py-[7px]">
                  <span className="min-w-0">
                    <Link
                      to={`/contacts/${pledge.contact_id}`}
                      className="block truncate font-semibold text-ink hover:text-accent-dark"
                    >
                      {pledge.contact_name}
                    </Link>
                    <span className="block text-[11.5px] text-muted">
                      {pledge.next_due_on ? `next due ${formatDate(pledge.next_due_on)}` : 'no schedule'}
                      {pledge.overdue_count > 0 ? (
                        <span className="text-flag-overdue">
                          {' '}
                          · {formatNumber(pledge.overdue_count)} overdue
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    {hidden ? (
                      <span className="text-muted">open</span>
                    ) : (
                      <>
                        <b className="text-gold">{formatMoney(pledge.outstanding)}</b>
                        <span className="block text-[11.5px] text-faint">
                          of {formatMoney(pledge.total_amount)}
                        </span>
                      </>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ReportCard>
      </div>

      <ReportCard
        title="Gifts"
        className="mt-4"
        action={
          <span className="text-[12px] text-faint">
            {formatNumber(gifts.length)} most recent{gifts.length >= 100 ? ' (capped at 100)' : ''}
          </span>
        }
      >
        {gifts.length === 0 ? (
          <ChartEmpty>No gifts recorded against this campaign yet.</ChartEmpty>
        ) : (
          <div className="max-h-[420px] overflow-auto">
            <table className="tabular w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-left text-[11px] tracking-[0.04em] text-faint uppercase">
                  <th scope="col" className="py-[6px] pr-2 font-semibold">
                    Donor
                  </th>
                  <th scope="col" className="py-[6px] px-2 font-semibold">
                    Date
                  </th>
                  <th scope="col" className="py-[6px] px-2 font-semibold">
                    Appeal
                  </th>
                  <th scope="col" className="py-[6px] px-2 font-semibold">
                    Fund
                  </th>
                  {hidden ? null : (
                    <th scope="col" className="py-[6px] pl-2 text-right font-semibold">
                      Amount
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-row">
                {gifts.map((gift) => (
                  <tr key={gift.id}>
                    <td className="py-[7px] pr-2">
                      <Link
                        to={`/contacts/${gift.contact_id}`}
                        className="font-semibold text-ink hover:text-accent-dark"
                      >
                        {gift.contact_name}
                      </Link>
                    </td>
                    <td className="py-[7px] px-2 text-nav">{formatDate(gift.donated_on)}</td>
                    <td className="py-[7px] px-2 text-muted">{gift.appeal_name ?? '—'}</td>
                    <td className="py-[7px] px-2 text-muted">{gift.fund_name ?? '—'}</td>
                    {hidden ? null : (
                      <td className="py-[7px] pl-2 text-right font-semibold text-gold">
                        {formatMoney(gift.amount)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportCard>
    </>
  )
}
