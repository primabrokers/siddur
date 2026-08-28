import { EmptyState } from '../components'

/** Gift Aid workspace — spec 05 §5. Replaced by features/giftaid (M7). */
export function GiftAidRoute() {
  return (
    <EmptyState
      title="Gift Aid"
      hint="The rolling claim, declaration chasing and the HMRC export land here (spec 05 §5)."
    />
  )
}
