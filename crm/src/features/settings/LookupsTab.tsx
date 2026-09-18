import { useEffect, useState } from 'react'
import { Button, Select, TextInput, useToast } from '../../components'
import { cn } from '../../lib/cn'
import {
  useCreateLookupOption,
  useLookupList,
  useLookupListNames,
  useUpdateLookupOption,
  type LookupOptionRow,
} from '../../lib/queries/settings'

const slug = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/** `interaction_kind` → `Interaction kind`. */
const humaniseList = (name: string): string =>
  name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

interface RowProps {
  option: LookupOptionRow
  readOnly: boolean
  onPatch: (patch: { label?: string; sort_order?: number; color?: string | null; is_active?: boolean }) => void
}

/**
 * One option. Edits are inline and commit on blur — the list editor is a
 * spreadsheet, not a form, and retiring an option never deletes it, so the
 * history that used it stays readable (06 §4 / 02 §6).
 */
function OptionRow({ option, readOnly, onPatch }: RowProps) {
  const [label, setLabel] = useState(option.label)
  const [sort, setSort] = useState(String(option.sort_order))

  useEffect(() => setLabel(option.label), [option.label])
  useEffect(() => setSort(String(option.sort_order)), [option.sort_order])

  return (
    <tr className={cn('border-t border-border', !option.is_active && 'text-faint')}>
      <td className="py-[6px] pr-3">
        <div className="w-[220px]">
          <TextInput
            value={label}
            disabled={readOnly}
            aria-label={`Label for ${option.value}`}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={() => label.trim() !== option.label && onPatch({ label: label.trim() })}
            className="py-[5px] text-[13px]"
          />
        </div>
      </td>
      <td className="py-[6px] pr-3 text-[12px] text-faint">
        <code>{option.value}</code>
      </td>
      <td className="py-[6px] pr-3">
        <input
          type="color"
          disabled={readOnly}
          aria-label={`Colour for ${option.value}`}
          value={option.color ?? '#EEF1F4'}
          onChange={(event) => onPatch({ color: event.target.value })}
          className="h-[26px] w-[38px] cursor-pointer rounded-[6px] border border-border bg-surface disabled:cursor-not-allowed"
        />
      </td>
      <td className="py-[6px] pr-3">
        <div className="w-[72px]">
          <TextInput
            type="number"
            value={sort}
            disabled={readOnly}
            aria-label={`Sort order for ${option.value}`}
            onChange={(event) => setSort(event.target.value)}
            onBlur={() => {
              const parsed = Number.parseInt(sort, 10)
              if (Number.isFinite(parsed) && parsed !== option.sort_order) onPatch({ sort_order: parsed })
            }}
            className="py-[5px] text-[13px]"
          />
        </div>
      </td>
      <td className="py-[6px] text-right">
        <label className="inline-flex items-center gap-2 text-[12.5px] text-muted">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={option.is_active}
            aria-label={`${option.value} is active`}
            onChange={(event) => onPatch({ is_active: event.target.checked })}
          />
          {option.is_active ? 'Active' : 'Retired'}
        </label>
      </td>
    </tr>
  )
}

export interface LookupsTabProps {
  readOnly: boolean
}

/**
 * The lookup-list editor (06 §4, 02 §6): pick a list, edit its options in
 * place, add one, retire one. Retiring hides a value from new dropdowns and
 * leaves every record that already used it untouched.
 */
export function LookupsTab({ readOnly }: LookupsTabProps) {
  const names = useLookupListNames()
  const [listName, setListName] = useState('')
  const options = useLookupList(listName)
  const update = useUpdateLookupOption()
  const create = useCreateLookupOption()
  const toast = useToast()

  const [newLabel, setNewLabel] = useState('')

  useEffect(() => {
    if (listName === '' && names.data && names.data.length > 0) setListName(names.data[0] as string)
  }, [names.data, listName])

  const rows = options.data ?? []

  async function addOption() {
    const label = newLabel.trim()
    if (label === '' || listName === '') return
    const value = slug(label)
    if (rows.some((row) => row.value === value)) {
      toast.push(`“${label}” already exists in this list`)
      return
    }
    await create.mutateAsync({
      list_name: listName,
      value,
      label,
      sort_order: rows.length === 0 ? 0 : Math.max(...rows.map((row) => row.sort_order)) + 10,
      color: null,
    })
    setNewLabel('')
    toast.push(`Added “${label}”`)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-[6px]">
          <span className="text-[12px] font-semibold text-muted">List</span>
          <div className="w-[220px]">
            <Select
              aria-label="Lookup list"
              value={listName}
              onChange={(event) => setListName(event.target.value)}
              options={(names.data ?? []).map((name) => ({ value: name, label: humaniseList(name) }))}
            />
          </div>
        </label>
        <p className="pb-[9px] text-[12px] text-muted">
          {rows.length} option{rows.length === 1 ? '' : 's'} · retiring never deletes history
        </p>
      </div>

      {options.isLoading ? (
        <div className="h-[140px] animate-pulse rounded-card border border-border bg-surface" />
      ) : rows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface px-4 py-6 text-center text-[13px] text-muted">
          This list has no options yet.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-surface px-4 py-2">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <thead>
              <tr className="text-[10.5px] font-semibold tracking-[0.08em] text-faint uppercase">
                <th className="py-2 pr-3 font-semibold">Label</th>
                <th className="py-2 pr-3 font-semibold">Stored value</th>
                <th className="py-2 pr-3 font-semibold">Colour</th>
                <th className="py-2 pr-3 font-semibold">Sort</th>
                <th className="py-2 text-right font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((option) => (
                <OptionRow
                  key={option.id}
                  option={option}
                  readOnly={readOnly}
                  onPatch={(patch) => update.mutate({ id: option.id, listName, patch })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {readOnly ? null : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-muted">Add an option</span>
            <div className="w-[260px]">
              <TextInput
                value={newLabel}
                onChange={(event) => setNewLabel(event.target.value)}
                placeholder="Label — e.g. “Shul committee”"
                aria-label="New option label"
                className="py-[7px] text-[13px]"
              />
            </div>
          </label>
          <Button disabled={newLabel.trim() === '' || create.isPending} onClick={() => void addOption()}>
            Add
          </Button>
          {newLabel.trim() !== '' ? (
            <span className="pb-[9px] text-[11.5px] text-faint">
              stored as <code>{slug(newLabel)}</code>
            </span>
          ) : null}
        </div>
      )}

      {update.error || create.error ? (
        <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {(update.error ?? create.error)?.message}
        </p>
      ) : null}
    </div>
  )
}
