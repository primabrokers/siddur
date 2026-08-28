import { useMemo, useState } from 'react'
import { Button, Pill, TextInput } from '../../components'
import { cn } from '../../lib/cn'
import {
  FIELD_SPECS,
  applyTemplate,
  deleteTemplate,
  giftMappingProblems,
  loadTemplates,
  mappingIsUsable,
  saveTemplate,
} from './mapping'
import type { ColumnMapping, ImportField, MappingTemplate, ParsedCsv } from './types'

/**
 * The shared control styling, applied to a bare `<select>`: the `Select`
 * primitive takes a flat `options` array, and this picker needs the
 * Contact/Gift `<optgroup>` split to stay readable at thirty columns.
 */
const controlClass =
  'w-full rounded-input border border-border bg-surface px-3 py-[6px] text-[12.5px] focus:border-accent focus:outline-none'

export interface MappingStepProps {
  parsed: ParsedCsv
  mapping: ColumnMapping
  onChange: (mapping: ColumnMapping) => void
}

/**
 * Step 2 — columns (06 §5).
 *
 * Every column is shown with its first two values, because "Ref" means nothing
 * and `GA-2019-114` means everything. The guesser has already filled the
 * dropdowns; a guessed choice is marked so the eye can go straight to what the
 * wizard was unsure about instead of re-reading all forty rows.
 *
 * A field can be claimed once — picking it in a second column releases it from
 * the first, which is the behaviour people expect from a mapping table and the
 * only way to avoid writing the same column twice.
 */
export function MappingStep({ parsed, mapping, onChange }: MappingStepProps) {
  const [templates, setTemplates] = useState<MappingTemplate[]>(() => loadTemplates())
  const [templateName, setTemplateName] = useState('')
  const [guessed] = useState<ColumnMapping>(() => [...mapping])

  const problems = giftMappingProblems(mapping)
  const usable = mappingIsUsable(mapping)

  const used = useMemo(() => new Set(mapping.filter((f): f is ImportField => f !== null)), [mapping])

  const setColumn = (index: number, field: ImportField | null) => {
    const next = [...mapping]
    // One column per field: taking a field frees whichever column held it.
    if (field) next.forEach((existing, i) => {
      if (existing === field && i !== index) next[i] = null
    })
    next[index] = field
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-3">
        <div className="flex flex-col gap-1">
          <span className="text-[11.5px] font-semibold tracking-[.04em] text-muted uppercase">
            Saved mappings
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {templates.length === 0 ? (
              <span className="text-[12.5px] text-faint">None yet — save this one once it is right.</span>
            ) : (
              templates.map((template) => (
                <span key={template.id} className="flex items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onChange(applyTemplate(template, parsed.headers))}
                  >
                    {template.name}
                  </Button>
                  <button
                    type="button"
                    aria-label={`Forget the mapping "${template.name}"`}
                    className="text-[12px] text-faint hover:text-flag-overdue"
                    onClick={() => setTemplates(deleteTemplate(template.id))}
                  >
                    ×
                  </button>
                </span>
              ))
            )}
          </div>
        </div>

        <div className="ml-auto flex items-end gap-2">
          <TextInput
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Name this mapping"
            aria-label="Name this mapping"
            className="w-[180px] py-[7px] text-[12.5px]"
          />
          <Button
            variant="outline"
            disabled={templateName.trim() === ''}
            onClick={() => {
              setTemplates(saveTemplate(templateName, parsed.headers, mapping))
              setTemplateName('')
            }}
          >
            Save mapping
          </Button>
        </div>
      </div>

      {!usable ? (
        <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          Map at least a first name, last name or organisation — otherwise there is nobody to create.
        </p>
      ) : null}

      {problems.map((problem) => (
        <p key={problem} className="rounded-input bg-[#FCF0E3] px-3 py-2 text-[12.5px] text-flag-today-ink">
          {problem}
        </p>
      ))}

      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-row">
              <th className="px-3 py-2 text-left font-semibold">Column in the file</th>
              <th className="px-3 py-2 text-left font-semibold">First values</th>
              <th className="px-3 py-2 text-left font-semibold">Imports as</th>
            </tr>
          </thead>
          <tbody>
            {parsed.headers.map((header, index) => {
              const field = mapping[index] ?? null
              const wasGuessed = field !== null && guessed[index] === field
              const samples = parsed.rows
                .slice(0, 2)
                .map((row) => row[index])
                .filter((v) => v && v !== '')
              return (
                <tr key={header} className="border-t border-border align-middle">
                  <td className="px-3 py-2 font-semibold whitespace-nowrap">{header}</td>
                  <td className="px-3 py-2 text-[12px] text-muted">
                    {samples.length === 0 ? <span className="text-faint">empty</span> : samples.join(' · ')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`What "${header}" imports as`}
                        value={field ?? ''}
                        onChange={(e) => setColumn(index, (e.target.value || null) as ImportField | null)}
                        className={cn(controlClass, 'w-[220px]')}
                      >
                        <option value="">Don't import</option>
                        <optgroup label="Contact">
                          {FIELD_SPECS.filter((s) => s.group === 'contact').map((spec) => (
                            <option key={spec.field} value={spec.field} disabled={used.has(spec.field) && field !== spec.field}>
                              {spec.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Gift">
                          {FIELD_SPECS.filter((s) => s.group === 'gift').map((spec) => (
                            <option key={spec.field} value={spec.field} disabled={used.has(spec.field) && field !== spec.field}>
                              {spec.label}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                      {wasGuessed ? (
                        <Pill variant="computed" title="The wizard guessed this from the header">
                          guessed
                        </Pill>
                      ) : null}
                    </div>
                    {field ? (
                      <p className="mt-1 text-[11.5px] text-faint">
                        {FIELD_SPECS.find((s) => s.field === field)?.hint ?? ''}
                      </p>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
