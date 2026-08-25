import { Button, EmptyState } from '../components'
import { formatDayHeading } from '../lib/format'
import { useCapture } from '../features/capture/QuickCapture'
import { PageHeader } from '../features/shell/PageHeader'

/**
 * Today / Action Stream — spec 04. The one screen the day is worked from.
 *
 * TODO(stream): metric strip (due today · overdue · retention · month giving),
 * Today/Upcoming/Done tabs, "Start my day", grouped rows (meetings · overdue
 * with "Reschedule all" · calls due · needs a next action) and the nudge rail.
 * Zero state swaps in `<RewardState>` (03 §5.6).
 */
export function TodayRoute() {
  const { openCapture } = useCapture()

  return (
    <>
      <PageHeader title="Today" subtitle={formatDayHeading(new Date())} />
      <EmptyState
        title="The Action Stream lands here"
        hint="Meetings, overdue follow-ups, calls due, and contacts with no next action — grouped and flag-sorted (red → orange → yellow → blue → grey), with the nudge rail alongside. Every number comes from contact_stats."
        action={
          <Button onClick={openCapture}>
            Quick capture
          </Button>
        }
      />
    </>
  )
}
