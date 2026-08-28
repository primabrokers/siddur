import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useTeamMember } from '../auth/useTeamMember'
import { ContactsList, type ContactsSource } from '../contacts/ContactsList'
import { useSavedViews, useViewCounts, useViewRows } from '../../lib/queries/views'
import { SaveViewSheet } from './SaveViewSheet'
import { ViewsBar } from './ViewsBar'
import { filtersEqual, isEmptyFilters, type ViewFilters } from './filterModel'

/**
 * Contacts as lenses (03 §4, 06 §1).
 *
 * One dataset, many named views: the route is always the same list, and a
 * saved view only changes which rows the query returns. The URL carries the
 * active view (`?view=<id>`) so a pinned view, a link and the back button all
 * agree; hand-edited criteria live in component state until they are saved,
 * which is exactly what "dirty" means here.
 */
export function ContactsWorkspace() {
  const [params, setParams] = useSearchParams()
  const member = useTeamMember()
  const views = useSavedViews(member.data?.id ?? null)

  const viewId = params.get('view')
  const activeView = useMemo(
    () => (views.data ?? []).find((view) => view.id === viewId) ?? null,
    [views.data, viewId],
  )

  const [filters, setFilters] = useState<ViewFilters>({})
  // Selecting a view resets the criteria to that view's own; a view is a
  // saved starting point, not a set of extra conditions on the last one.
  useEffect(() => {
    setFilters(activeView ? activeView.filters : {})
  }, [activeView])

  const contactViews = useMemo(
    () => (views.data ?? []).filter((view) => view.entity === 'contacts'),
    [views.data],
  )
  const counts = useViewCounts(contactViews)

  const filtered = !isEmptyFilters(filters)
  const rows = useViewRows(filters, filtered)

  const dirty = activeView ? !filtersEqual(filters, activeView.filters) : filtered
  const [saveOpen, setSaveOpen] = useState(false)

  const selectView = useCallback(
    (id: string | null) => {
      const next = new URLSearchParams(params)
      if (id) next.set('view', id)
      else next.delete('view')
      next.delete('new')
      setParams(next, { replace: true })
      // The effect above only fires when the resolved view changes; clearing
      // the selection has to clear the criteria itself.
      if (!id) setFilters({})
    },
    [params, setParams],
  )

  // The palette's "New contact" lands here as `?new=contact` (03 §3).
  const createOpen = params.get('new') === 'contact'
  const setCreateOpen = useCallback(
    (open: boolean) => {
      const next = new URLSearchParams(params)
      if (open) next.set('new', 'contact')
      else next.delete('new')
      setParams(next, { replace: true })
    },
    [params, setParams],
  )

  const source: ContactsSource | undefined = filtered
    ? {
        rows: rows.data?.rows ?? [],
        isLoading: rows.isLoading,
        error: rows.error,
        statsError: rows.data?.statsError ?? null,
      }
    : undefined

  const title = activeView && !dirty ? activeView.name : 'Contacts'

  return (
    <>
      <ContactsList
        source={source}
        title={title}
        emptyHint={
          filtered
            ? 'Nobody matches these criteria today. A queue at zero is the goal — this one is done.'
            : undefined
        }
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
        toolbar={
          <ViewsBar
            views={views.data ?? []}
            activeId={activeView?.id ?? null}
            filters={filters}
            dirty={dirty}
            counts={counts}
            onSelectView={selectView}
            onFiltersChange={setFilters}
            onSaveAsView={() => setSaveOpen(true)}
          />
        }
      />

      <SaveViewSheet
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        filters={filters}
        onSaved={(id) => selectView(id)}
      />
    </>
  )
}
