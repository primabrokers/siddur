import { SectionLabel } from '../../components'
import { cn } from '../../lib/cn'
import {
  AI_FEATURES_KEY,
  readAiFeatures,
  useAutomationRules,
  useUpdateAutomationRule,
} from '../../lib/queries/settings'
import { AI_FEATURES } from './ruleSchemas'

export interface AiTabProps {
  readOnly: boolean
}

/**
 * What is deployed, what each one does, and — the line that matters — what
 * happens when there is no API key. Every answer is "the manual path", because
 * that is the rule the product is built on (CLAUDE.md rule 6).
 */
const AI_FUNCTIONS = [
  {
    name: 'ai-quick-capture',
    does: 'turns a dictated note into editable chips',
    noKey: 'without a key: the manual log form, prefilled with the dictation',
  },
  {
    name: 'donor-brief',
    does: 'the five-line brief and the rolling holding line',
    noKey: 'without a key: no brief offered; the timeline is unchanged',
  },
  {
    name: 'draft-message',
    does: 'first drafts of thank-yous, follow-ups and Gift Aid requests',
    noKey: 'without a key: a blank compose box',
  },
  {
    name: 'send-digest',
    does: 'the morning digest, hourly at each member’s digest hour',
    noKey: 'without a key: the digest still sends, without its opening sentence',
  },
] as const

/**
 * AI settings (06 §4, 09 §1).
 *
 * Every feature is independently switchable, and switching one off is never a
 * dead end: the manual path behind it always works (09 §1 / CLAUDE.md rule 6).
 * A feature with no stored value is **on** — that is how the app shipped, and
 * a missing row should not silently disable the product.
 *
 * The key itself is deliberately not shown, edited or fetched here. It lives
 * as a Supabase secret read by the edge function, so the browser never holds
 * it and no client build can leak it.
 */
export function AiTab({ readOnly }: AiTabProps) {
  const rules = useAutomationRules()
  const update = useUpdateAutomationRule()

  const stored = readAiFeatures(rules.data)
  const hasRow = (rules.data ?? []).some((rule) => rule.rule_key === AI_FEATURES_KEY)
  const enabled = (key: string): boolean => (hasRow && key in stored ? stored[key] === true : true)

  const toggle = (key: string, next: boolean) => {
    const params: Record<string, boolean> = {}
    for (const feature of AI_FEATURES) params[feature.key] = enabled(feature.key)
    params[key] = next
    update.mutate({ rule_key: AI_FEATURES_KEY, patch: { is_enabled: true, params } })
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <SectionLabel>Features</SectionLabel>
        <ul className="flex flex-col gap-2">
          {AI_FEATURES.map((feature) => {
            const on = enabled(feature.key)
            return (
              <li
                key={feature.key}
                className="flex items-start gap-3 rounded-card border border-border bg-surface px-4 py-3"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${feature.label} enabled`}
                  disabled={readOnly || update.isPending}
                  onClick={() => toggle(feature.key, !on)}
                  className={cn(
                    'relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors disabled:opacity-50',
                    on ? 'bg-accent' : 'bg-[#D7DCE2]',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-[3px] h-[16px] w-[16px] rounded-full bg-surface transition-all',
                      on ? 'left-[19px]' : 'left-[3px]',
                    )}
                  />
                </button>
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold">{feature.label}</div>
                  <p className="mt-[2px] text-[12.5px] text-muted">{feature.description}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Edge functions</SectionLabel>
        <ul className="flex flex-col gap-[2px] rounded-card border border-border bg-surface px-4 py-3 text-[12.5px] text-muted">
          {AI_FUNCTIONS.map((fn) => (
            <li key={fn.name} className="flex flex-wrap items-baseline gap-x-2 py-[3px]">
              <code className="text-ink">{fn.name}</code>
              <span className="text-faint">·</span>
              <span>{fn.does}</span>
              <span className="text-faint">·</span>
              <span>{fn.noKey}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11.5px] leading-[1.5] text-faint">
          Each call carries the signed-in fundraiser’s own token, so an AI context can never contain a row
          they could not open for themselves (11 §2). <code>send-digest</code> is the exception and runs as
          the scheduler, which is why it carries no amounts at all.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Model access</SectionLabel>
        <div className="rounded-card border border-border bg-surface px-4 py-3 text-[12.5px] text-muted">
          <p>
            The Claude API key is stored as the Supabase secret{' '}
            <code className="text-ink">ANTHROPIC_API_KEY</code> and is read only by the{' '}
            <code className="text-ink">ai-quick-capture</code> edge function. It is never sent to the
            browser and cannot be viewed or changed from this screen — rotate it in the Supabase
            dashboard.
          </p>
          <p className="mt-2">
            The function runs with the <em>requesting user’s</em> token, not a service-role key, so every
            AI context inherits the same row-level rules as the rest of the app: a private note that is
            invisible to you is invisible to the model too (11 §2).
          </p>
          <p className="mt-2">
            Every AI touchpoint is labelled “Drafted with AI” until a person accepts it, and each accept,
            edit and reject is written to <code className="text-ink">ai_activity_log</code> (09 §1).
          </p>
        </div>
      </section>

      {update.error ? (
        <p role="alert" className="rounded-input bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue">
          {update.error.message}
        </p>
      ) : null}
    </div>
  )
}
