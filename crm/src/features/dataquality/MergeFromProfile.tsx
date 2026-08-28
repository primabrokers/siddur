import { useState } from 'react'
import { Button, Pill, Sheet } from '../../components'
import { useMergeCandidates } from '../../lib/queries/dataquality'
import { displayName } from '../contacts/normalise'
import type { ContactRow } from '../contacts/types'
import { MergeTool } from './MergeTool'

export interface MergeFromProfileProps {
  open: boolean
  onClose: () => void
  contact: ContactRow
  onMerged?: (winnerId: string) => void
}

/**
 * "Merge with a duplicate…" from the profile's ⋯ menu (06 §5).
 *
 * A short picker before the merge tool, because merging from a profile means
 * the second record is not yet chosen. The candidates are scored with the same
 * signals as everything else (02 §6) so the likely one is first, and the list
 * is deliberately short — if the right record is not in it, the duplicates
 * queue is the better door.
 */
export function MergeFromProfile({ open, onClose, contact, onMerged }: MergeFromProfileProps) {
  const [partner, setPartner] = useState<ContactRow | null>(null)
  const candidates = useMergeCandidates(open ? contact : null)

  return (
    <>
      <Sheet
        open={open && partner === null}
        onClose={onClose}
        title="Merge with a duplicate"
        width={520}
        leading={
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            Cancel
          </button>
        }
      >
        <p className="mb-3 text-[13px] text-muted">
          Records that share an email, a phone number or a close name with{' '}
          <strong className="font-semibold text-ink">{displayName(contact) || 'this contact'}</strong>.
        </p>

        {candidates.isLoading ? (
          <p className="py-6 text-center text-[13px] text-muted">Looking…</p>
        ) : (candidates.data ?? []).length === 0 ? (
          <p className="rounded-card border border-border bg-surface px-4 py-6 text-center text-[13px] text-muted">
            Nothing looks like a duplicate of this record.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="merge-candidates">
            {(candidates.data ?? []).map((candidate) => (
              <li
                key={candidate.id}
                className="flex items-center gap-3 rounded-card border border-border bg-surface px-3 py-2"
              >
                <div className="min-w-0 grow">
                  <p className="truncate text-[13.5px] font-semibold">
                    {displayName(candidate) || 'Unnamed contact'}
                  </p>
                  <p className="truncate text-[12px] text-muted">
                    {[candidate.email, candidate.phone, candidate.city].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                {candidate.email && candidate.email === contact.email ? (
                  <Pill variant="computed">same email</Pill>
                ) : null}
                <Button size="sm" onClick={() => setPartner(candidate)}>
                  Compare
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      <MergeTool
        open={partner !== null}
        onClose={() => setPartner(null)}
        a={contact}
        b={partner}
        onMerged={(winnerId) => {
          setPartner(null)
          onClose()
          onMerged?.(winnerId)
        }}
      />
    </>
  )
}
