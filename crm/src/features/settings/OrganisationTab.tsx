import { useEffect, useState } from 'react'
import { Button, Field, TextInput, useToast } from '../../components'
import {
  ORG_DETAILS_KEY,
  readOrgDetails,
  useAutomationRules,
  useUpdateAutomationRule,
  type OrgDetails,
} from '../../lib/queries/settings'

export interface OrganisationTabProps {
  readOnly: boolean
}

/**
 * Organisation details (06 §4). The charity number and HMRC reference feed the
 * Gift Aid claim file (05 §5), so they belong to the organisation rather than
 * to any person.
 *
 * Storage: `automation_rules('org_details').params`. See `queries/settings.ts`
 * for why, and what it costs.
 */
export function OrganisationTab({ readOnly }: OrganisationTabProps) {
  const rules = useAutomationRules()
  const update = useUpdateAutomationRule()
  const toast = useToast()

  const stored = readOrgDetails(rules.data)
  const [draft, setDraft] = useState<OrgDetails>(stored)

  useEffect(() => {
    setDraft(stored)
    // Re-seeding from the server whenever it changes is the intent; the draft
    // is a working copy, not a second source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.name, stored.charity_number, stored.hmrc_reference, stored.contact_email])

  const dirty =
    draft.name !== stored.name ||
    draft.charity_number !== stored.charity_number ||
    draft.hmrc_reference !== stored.hmrc_reference ||
    draft.contact_email !== stored.contact_email

  const set = (key: keyof OrgDetails) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value }))

  async function save() {
    await update.mutateAsync({
      rule_key: ORG_DETAILS_KEY,
      patch: { is_enabled: true, params: { ...draft } },
    })
    toast.push('Organisation details saved')
  }

  if (rules.isLoading) {
    return <div className="h-[220px] animate-pulse rounded-card border border-border bg-surface" />
  }

  return (
    <div className="flex max-w-[560px] flex-col gap-4">
      <Field label="Organisation name">
        <TextInput value={draft.name} disabled={readOnly} onChange={set('name')} placeholder="The yeshiva's registered name" />
      </Field>
      <Field label="Charity number" hint="As registered with the Charity Commission.">
        <TextInput value={draft.charity_number} disabled={readOnly} onChange={set('charity_number')} />
      </Field>
      <Field
        label="HMRC reference"
        hint="The Gift Aid reference HMRC issued — it appears on every Charities Online claim."
      >
        <TextInput value={draft.hmrc_reference} disabled={readOnly} onChange={set('hmrc_reference')} />
      </Field>
      <Field label="Contact email" hint="The authorised official HMRC correspondence goes to.">
        <TextInput type="email" value={draft.contact_email} disabled={readOnly} onChange={set('contact_email')} />
      </Field>

      {readOnly ? null : (
        <div className="flex items-center gap-3">
          <Button disabled={!dirty || update.isPending} onClick={() => void save()}>
            {update.isPending ? 'Saving…' : 'Save'}
          </Button>
          {dirty ? <span className="text-[12px] text-muted">Unsaved changes</span> : null}
        </div>
      )}

      {update.error ? (
        <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {update.error.message}
        </p>
      ) : null}
    </div>
  )
}
