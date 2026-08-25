import { EmptyState } from '../components'
import { PageHeader } from '../features/shell/PageHeader'

/**
 * Giving — spec 07. Money in, receipts out, Gift Aid.
 *
 * TODO(giving): gift entry with ask-array chips, pledges + installments,
 * standing orders and missed-payment detection, receipts, Gift Aid claim
 * builder and the HMRC file (an outward action — it gets a confirm, I-12).
 */
export function GivingRoute() {
  return (
    <>
      <PageHeader title="Giving" subtitle="Gifts, pledges, standing orders, Gift Aid" />
      <EmptyState
        title="Giving lands here"
        hint="Recording gifts against fund / campaign / appeal, pledge schedules and their installments, recurring agreements with missed-payment detection, receipting, and the Gift Aid claim run."
      />
    </>
  )
}
