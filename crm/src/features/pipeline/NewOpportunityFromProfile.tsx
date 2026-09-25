import { useMemo } from 'react'
import { useToast } from '../../components'
import { useLookupOptions } from '../../lib/queries/contacts'
import { useSaveOpportunity } from '../../lib/queries/pipeline'
import { displayName } from '../contacts/normalise'
import type { ContactRow } from '../contacts/types'
import { OpportunitySheet } from './OpportunitySheet'
import { toStages } from './logic'
import type { OpportunityDraft } from './types'

export interface NewOpportunityFromProfileProps {
  open: boolean
  onClose: () => void
  contact: ContactRow
}

/**
 * "New opportunity" from the donor profile's ⋯ menu (06 §2 · 07 §9.1).
 *
 * Same shape as `dataquality/MergeFromProfile`: the profile owns a boolean, the
 * feature owns everything else — the stage list, the write and the toast — so
 * the contacts screen never learns what an opportunity is.
 */
export function NewOpportunityFromProfile({ open, onClose, contact }: NewOpportunityFromProfileProps) {
  const stageOptions = useLookupOptions('opportunity_stage')
  const save = useSaveOpportunity()
  const toast = useToast()

  const stages = useMemo(() => toStages(stageOptions.data), [stageOptions.data])

  async function onSave(draft: OpportunityDraft) {
    await save.mutateAsync({ id: null, draft })
    toast.push('Ask added to the pipeline', { tone: 'good' })
  }

  return (
    <OpportunitySheet
      open={open}
      onClose={onClose}
      contactId={contact.id}
      contactName={displayName(contact) || contact.organization || 'this donor'}
      stages={stages}
      pending={save.isPending}
      onSave={onSave}
    />
  )
}
