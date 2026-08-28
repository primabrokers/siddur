/**
 * Fundraiser activity (06 §3) — interactions logged, tasks completed and gifts
 * taken, per team member, over the tail of the selected period.
 *
 * Deliberately effort, not league table: the columns are things a fundraiser
 * controls. The gift column is there because it is the one outcome the CRM can
 * attribute honestly (who entered it), and it is dropped entirely for a viewer
 * who may not see amounts.
 */

import { formatMoney, formatNumber } from '../../lib/format'
import { ChartEmpty, ReportCard } from './charts'
import type { ActivitySummary, DrillTarget } from './types'

export interface ActivityCardProps {
  activity: ActivitySummary
  amountsHidden: boolean
  /** The screen's year, so an interaction drill lands in the right period. */
  year: number | null
  onDrill: (target: DrillTarget) => void
}

export function ActivityCard({ activity, amountsHidden, year, onDrill }: ActivityCardProps) {
  const members = activity.members ?? []
  const busy = members.filter(
    (member) => member.interactions + member.tasks_completed + member.gifts > 0,
  )

  return (
    <ReportCard
      title={`Fundraiser activity — ${activity.label.toLowerCase()}`}
      action={<span className="text-[12px] text-faint">{formatNumber(members.length)} on the team</span>}
    >
      {busy.length === 0 ? (
        <ChartEmpty>
          Nothing logged in this window yet — activity appears as the team records conversations,
          closes tasks and enters gifts.
        </ChartEmpty>
      ) : (
        <div className="overflow-x-auto">
          <table className="tabular w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[11px] tracking-[0.04em] text-faint uppercase">
                <th scope="col" className="py-1 pr-2 font-semibold">
                  Team member
                </th>
                <th scope="col" className="py-1 px-2 text-right font-semibold">
                  Interactions
                </th>
                <th scope="col" className="py-1 px-2 text-right font-semibold">
                  Tasks done
                </th>
                <th scope="col" className="py-1 pl-2 text-right font-semibold">
                  Gifts
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-row">
              {members.map((member) => (
                <tr key={member.member_id}>
                  <td className="py-[7px] pr-2 text-ink">{member.member_name}</td>
                  <td className="py-[7px] px-2 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        onDrill({
                          key: 'activity',
                          title: `${member.member_name} · people spoken to`,
                          arg: member.member_id,
                          year,
                        })
                      }
                      title={`${member.member_name}: open the people behind ${formatNumber(member.interactions)} interactions`}
                      className="rounded-[6px] px-[5px] font-semibold hover:bg-accent-soft hover:text-accent-dark"
                    >
                      {formatNumber(member.interactions)}
                    </button>
                  </td>
                  <td className="py-[7px] px-2 text-right text-nav">
                    {formatNumber(member.tasks_completed)}
                  </td>
                  <td className="py-[7px] pl-2 text-right text-nav">
                    {formatNumber(member.gifts)}
                    {amountsHidden || member.gift_total === null ? null : (
                      <span className="ml-[6px] font-semibold text-gold">
                        {formatMoney(member.gift_total)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ReportCard>
  )
}
