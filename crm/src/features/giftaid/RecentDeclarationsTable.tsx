import { Link } from 'react-router'
import { Button } from '../../components'
import { formatDate } from '../../lib/format'
import { displayName } from '../contacts/normalise'
import { awaitsWrittenConfirmation, coversLabel, METHOD_LABEL } from './logic'
import type { DeclarationRow, GaContactRow } from './types'

export interface RecentDeclarationsTableProps {
  declarations: DeclarationRow[]
  contacts: Record<string, GaContactRow>
  canEdit: boolean
  /** Stamp the written confirmation of an oral declaration as sent. */
  onConfirm: (declaration: DeclarationRow) => void
  onCancel: (declaration: DeclarationRow) => void
  onNew: () => void
}

const VISIBLE = 8

/**
 * Recent declarations (05 §5 panel 2, wireframe A7).
 *
 * The one piece of state this table insists on: an **oral** declaration reads
 * "confirmation pending" until the written confirmation HMRC requires has been
 * sent (02 §3.7). Until then it covers nothing, which is exactly what
 * `crm_gift_aid_status` already believes.
 */
export function RecentDeclarationsTable({
  declarations,
  contacts,
  canEdit,
  onConfirm,
  onCancel,
  onNew,
}: RecentDeclarationsTableProps) {
  const rows = declarations.slice(0, VISIBLE)

  return (
    <section
      aria-label="Recent declarations"
      className="flex flex-col rounded-card-lg border border-border bg-surface pt-[14px] pb-1"
    >
      <div className="flex items-baseline justify-between gap-3 px-5 pb-2">
        <h2 className="text-[12px] font-bold tracking-[0.06em] text-muted uppercase">Recent declarations</h2>
        {canEdit ? (
          <Button variant="ghost" size="sm" onClick={onNew}>
            ＋ New declaration
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="px-5 pb-4 text-[12.5px] text-faint">
          No declarations on file yet. Record one from a donor&apos;s profile or from the queue above.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="text-[11px] font-bold tracking-[0.06em] text-muted uppercase">
                <th className="border-b border-row px-[10px] py-[9px] pl-5 text-left font-bold">Donor</th>
                <th className="border-b border-row px-[10px] py-[9px] text-left font-bold">Date</th>
                <th className="border-b border-row px-[10px] py-[9px] text-left font-bold">Method</th>
                <th className="border-b border-row px-[10px] py-[9px] text-left font-bold">Covers</th>
                <th className="border-b border-row px-[10px] py-[9px] text-left font-bold">Wording</th>
                {canEdit ? <th className="border-b border-row px-[10px] py-[9px] text-left font-bold" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((declaration) => {
                const contact = contacts[declaration.contact_id] ?? null
                const pending = awaitsWrittenConfirmation(declaration)
                return (
                  <tr key={declaration.id} className={declaration.cancelled_on ? 'text-muted' : undefined}>
                    <td className="border-b border-row px-[10px] py-[9px] pl-5 whitespace-nowrap">
                      <Link to={`/contacts/${declaration.contact_id}`} className="font-bold text-ink hover:text-accent">
                        {displayName(contact) || 'Unknown donor'}
                      </Link>
                    </td>
                    <td className="border-b border-row px-[10px] py-[9px] whitespace-nowrap">
                      {formatDate(declaration.declared_on)}
                    </td>
                    <td className="border-b border-row px-[10px] py-[9px]">
                      {METHOD_LABEL[declaration.method] ?? declaration.method}
                      {pending ? (
                        <span className="ml-[6px] rounded-pill bg-[#FFF4E3] px-2 py-[1px] text-[10.5px] font-bold text-[#B4650F]">
                          confirmation pending
                        </span>
                      ) : null}
                      {declaration.cancelled_on ? (
                        <span className="ml-[6px] rounded-pill bg-row px-2 py-[1px] text-[10.5px] font-bold text-muted">
                          cancelled {formatDate(declaration.cancelled_on)}
                        </span>
                      ) : null}
                    </td>
                    <td className="border-b border-row px-[10px] py-[9px]">
                      {coversLabel(declaration)}
                      {declaration.covers_from ? (
                        <span className="text-muted"> from {formatDate(declaration.covers_from)}</span>
                      ) : null}
                    </td>
                    <td className="border-b border-row px-[10px] py-[9px] whitespace-nowrap text-muted">
                      {declaration.wording_version ?? '—'}
                    </td>
                    {canEdit ? (
                      <td className="border-b border-row px-[10px] py-[9px]">
                        <div className="flex justify-end gap-2">
                          {pending ? (
                            <Button variant="accentOutline" size="sm" onClick={() => onConfirm(declaration)}>
                              Confirmation sent
                            </Button>
                          ) : null}
                          {declaration.cancelled_on ? null : (
                            <Button variant="ghost" size="sm" onClick={() => onCancel(declaration)}>
                              Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
