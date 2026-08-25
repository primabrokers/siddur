import { useNavigate } from 'react-router'
import { Button, EmptyState } from '../components'
import { PageHeader } from '../features/shell/PageHeader'

export function NotFoundRoute() {
  const navigate = useNavigate()

  return (
    <>
      <PageHeader title="Not found" />
      <EmptyState
        title="There's nothing at this address"
        hint="The link may be stale, or the record may have been merged away."
        action={<Button onClick={() => navigate('/')}>Back to Today</Button>}
      />
    </>
  )
}
