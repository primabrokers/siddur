import { Link, useParams } from 'react-router'
import { EmptyState } from '../components'
import { PageHeader } from '../features/shell/PageHeader'

/**
 * Donor profile — spec 05. Read + act, mobile-first.
 *
 * TODO(profile): header (flag, stage/priority pills, computed donor status,
 * things-to-remember), timeline, giving summary, pledges, Gift Aid state,
 * next action with the close-the-loop follow-up prompt (I-4).
 */
export function ContactDetailRoute() {
  const { id } = useParams<{ id: string }>()

  return (
    <>
      <PageHeader
        title="Contact"
        subtitle={
          <>
            <Link to="/contacts" className="text-accent hover:text-accent-dark">
              Contacts
            </Link>
            {' · '}
            <code className="text-[12px]">{id}</code>
          </>
        }
      />
      <EmptyState
        title="The donor profile lands here"
        hint="Header with the flag and pills, the interaction timeline, giving and pledge summaries, Gift Aid state, and the next action — where completing one always opens the follow-up prompt in the same dialog."
      />
    </>
  )
}
