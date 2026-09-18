import { useEffect, useState } from 'react'
import { EmptyState, Pill, Tabs } from '../components'
import { useTeamMember } from '../features/auth/useTeamMember'
import { DuplicatesQueue } from '../features/dataquality'
import { ImportWizard } from '../features/import'
import { PageHeader } from '../features/shell/PageHeader'

type ImportTab = 'wizard' | 'duplicates'

/**
 * Data quality (06 §5): the CSV import wizard and the duplicates queue, the
 * two halves of "get the data in and keep it clean".
 *
 * **Desktop only, and honestly so.** The spec makes merge desktop-only, and an
 * import is the same kind of work: thirty columns and a side-by-side
 * comparison do not survive a 390px phone. Rather than shipping a cramped
 * version, the screen says what to do instead — the same courtesy the rest of
 * the app extends when a surface genuinely does not fit (03 §7).
 */
export function ImportRoute() {
  const { data: member, isPending } = useTeamMember()
  const [tab, setTab] = useState<ImportTab>('wizard')
  const [desktop, setDesktop] = useState(true)

  // Measured, not guessed: the same 1024px breakpoint the shell uses (03 §1).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(min-width: 1024px)')
    const apply = () => setDesktop(query.matches)
    apply()
    query.addEventListener?.('change', apply)
    return () => query.removeEventListener?.('change', apply)
  }, [])

  const role = member?.role ?? null
  const isAdmin = role === 'admin'
  const canImport = role === 'admin' || role === 'fundraiser'

  if (!desktop) {
    return (
      <>
        <PageHeader title="Import & duplicates" />
        <EmptyState
          title="This one needs a bigger screen"
          hint="Mapping thirty columns and comparing two records side by side is desktop work (06 §5). Open the CRM on a laptop and this screen will be here."
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Import & duplicates"
        subtitle="Bring the spreadsheet in, then keep the book free of duplicates (06 §5)."
        actions={
          isPending ? null : isAdmin ? (
            <Pill tone="accent">Admin</Pill>
          ) : canImport ? (
            <Pill>Import only</Pill>
          ) : (
            <Pill>Read only</Pill>
          )
        }
      />

      <Tabs
        items={[
          { id: 'wizard', label: 'Import' },
          { id: 'duplicates', label: 'Duplicates' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as ImportTab)}
        aria-label="Data quality sections"
        className="mb-4"
      />

      {tab === 'wizard' ? (
        canImport ? (
          <ImportWizard isAdmin={isAdmin} />
        ) : (
          <EmptyState
            title="Importing is not yours to do"
            hint="Creating records in bulk is an admin and fundraiser capability (11 §1). The database enforces it — this screen only reflects it."
          />
        )
      ) : (
        <DuplicatesQueue isAdmin={isAdmin} />
      )}
    </>
  )
}
