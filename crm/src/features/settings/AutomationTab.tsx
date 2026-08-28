import { useEffect, useState } from 'react'
import { SectionLabel, TextInput } from '../../components'
import { cn } from '../../lib/cn'
import {
  useAutomationRules,
  useUpdateAutomationRule,
  type AutomationRuleRow,
} from '../../lib/queries/settings'
import {
  NON_RULE_KEYS,
  RULE_KIND_LABEL,
  ruleSchema,
  type RuleField,
  type RuleKind,
} from './ruleSchemas'

/* ------------------------------------------------------------------ parts */

function Toggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-[#D7DCE2]',
      )}
    >
      <span
        className={cn(
          'absolute top-[3px] h-[16px] w-[16px] rounded-full bg-surface transition-all',
          checked ? 'left-[19px]' : 'left-[3px]',
        )}
      />
    </button>
  )
}

function ParamField({
  field,
  value,
  disabled,
  onCommit,
}: {
  field: RuleField
  value: unknown
  disabled: boolean
  onCommit: (next: unknown) => void
}) {
  const [draft, setDraft] = useState(value === null || value === undefined ? '' : String(value))
  useEffect(() => {
    setDraft(value === null || value === undefined ? '' : String(value))
  }, [value])

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        <input
          type="checkbox"
          disabled={disabled}
          checked={value === true}
          aria-label={field.label}
          onChange={(event) => onCommit(event.target.checked)}
        />
        {field.label}
      </label>
    )
  }

  const numeric = field.type === 'number' || field.type === 'money'
  return (
    <label className="flex items-center gap-2 text-[12.5px] text-muted">
      <span className="whitespace-nowrap">{field.label}</span>
      <TextInput
        type={numeric ? 'number' : 'text'}
        value={draft}
        disabled={disabled}
        aria-label={field.label}
        title={field.help}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (numeric) {
            const parsed = Number(draft)
            if (Number.isFinite(parsed) && parsed !== Number(value)) onCommit(parsed)
          } else if (draft !== String(value ?? '')) {
            onCommit(draft)
          }
        }}
        className={cn('py-[4px] text-[12.5px]', numeric ? 'w-[84px]' : 'w-[150px]')}
      />
      {field.suffix ? <span className="text-faint">{field.suffix}</span> : null}
    </label>
  )
}

/* -------------------------------------------------------------------- tab */

export interface AutomationTabProps {
  readOnly: boolean
}

/**
 * The rule table (06 §4, 08 §7): one row per `automation_rules` key, with its
 * switch, a plain-English description, and parameter fields generated from the
 * static schema in `ruleSchemas.ts`.
 *
 * A key with no schema is not hidden — it renders read-only with its raw
 * params, so a rule added by a migration is visible and toggleable the day it
 * lands and only its *tuning* waits for three lines of code.
 */
export function AutomationTab({ readOnly }: AutomationTabProps) {
  const rules = useAutomationRules()
  const update = useUpdateAutomationRule()

  const rows = (rules.data ?? []).filter((rule) => !NON_RULE_KEYS.has(rule.rule_key))
  const kinds: RuleKind[] = ['trigger', 'nightly']

  const setParam = (rule: AutomationRuleRow, key: string, value: unknown) =>
    update.mutate({ rule_key: rule.rule_key, patch: { is_enabled: rule.is_enabled, params: { ...rule.params, [key]: value } } })

  if (rules.isLoading) {
    return <div className="h-[280px] animate-pulse rounded-card border border-border bg-surface" />
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[12.5px] text-muted">
        Automations create tasks, flags and drafts. They never send anything to a donor — that is always a
        person’s decision (I-10).
      </p>

      {kinds.map((kind) => {
        const group = rows.filter((rule) => (ruleSchema(rule.rule_key)?.kind ?? 'nightly') === kind)
        if (group.length === 0) return null
        return (
          <section key={kind} className="flex flex-col gap-2">
            <SectionLabel>{RULE_KIND_LABEL[kind]}</SectionLabel>
            <ul className="flex flex-col gap-2">
              {group.map((rule) => {
                const schema = ruleSchema(rule.rule_key)
                return (
                  <li
                    key={rule.rule_key}
                    className="flex items-start gap-3 rounded-card border border-border bg-surface px-4 py-3"
                  >
                    <Toggle
                      checked={rule.is_enabled}
                      disabled={readOnly || update.isPending}
                      label={`${schema?.label ?? rule.rule_key} enabled`}
                      onChange={(next) =>
                        update.mutate({ rule_key: rule.rule_key, patch: { is_enabled: next } })
                      }
                    />
                    <div className="min-w-0 grow">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold">{schema?.label ?? rule.rule_key}</span>
                        <code className="text-[11px] text-faint">{rule.rule_key}</code>
                        {schema?.phase2 ? (
                          <span className="rounded-pill border border-chip-border px-[7px] py-[1px] text-[10.5px] text-faint">
                            Phase 2
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-[2px] text-[12.5px] text-muted">
                        {schema?.description ??
                          'No description written for this rule yet — its parameters are shown as stored.'}
                      </p>

                      {schema && schema.fields.length > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                          {schema.fields.map((field) => (
                            <ParamField
                              key={field.key}
                              field={field}
                              value={rule.params[field.key]}
                              disabled={readOnly || !rule.is_enabled}
                              onCommit={(next) => setParam(rule, field.key, next)}
                            />
                          ))}
                        </div>
                      ) : !schema && Object.keys(rule.params).length > 0 ? (
                        <pre className="mt-2 overflow-x-auto rounded-input bg-ground px-3 py-2 text-[11.5px] text-muted">
                          {JSON.stringify(rule.params, null, 2)}
                        </pre>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {update.error ? (
        <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {update.error.message}
        </p>
      ) : null}
    </div>
  )
}
