import { GivingView } from '../features/giving/GivingView'

/**
 * Giving — spec 05 §1–§4. Money in, promises tracked, thanks and receipts out.
 *
 * TODO(M7): the Gift Aid workspace (05 §5) — the rolling claim, the
 * missing-declaration queue and the HMRC Charities Online export. The gift
 * sheet's inline eligibility line is the only Gift Aid surface here.
 */
export function GivingRoute() {
  return <GivingView />
}
