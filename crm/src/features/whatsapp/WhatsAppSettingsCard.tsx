import { Button, SectionLabel } from '../../components'
import { cn } from '../../lib/cn'
import { useSyncWaTemplates, useWaConfig, useWaTemplates, WA_NOTICE } from '../../lib/queries/wa'
import type { WaCallError } from '../../lib/queries/wa'

/** The four secrets, in the order the Meta app configuration asks for them. */
const SECRETS = [
  {
    name: 'WA_ACCESS_TOKEN',
    what: 'the system-user access token the Cloud API is called with',
    where: 'Meta Business Manager → Business settings → Users → System users → Generate token',
  },
  {
    name: 'WA_PHONE_NUMBER_ID',
    what: 'which business number sends',
    where: 'Meta app → WhatsApp → API setup → “Phone number ID”',
  },
  {
    name: 'WA_VERIFY_TOKEN',
    what: 'the shared string that proves we own the webhook URL',
    where: 'invent one, paste the same value into the Meta app’s Webhook config',
  },
  {
    name: 'WA_APP_SECRET',
    what: 'signs every webhook delivery (HMAC-SHA256 over the raw body)',
    where: 'Meta app → App settings → Basic → “App secret”',
  },
  {
    name: 'WA_BUSINESS_ACCOUNT_ID',
    what: 'only needed to sync the approved-template list',
    where: 'Meta app → WhatsApp → API setup → “WhatsApp Business Account ID”',
  },
] as const

function StatusDot({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-[8px] w-[8px] shrink-0 rounded-full', on ? 'bg-good' : 'bg-faint')}
    />
  )
}

function Line({ on, label, detail }: { on: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2 py-[3px]">
      <span className="mt-[5px]">
        <StatusDot on={on} />
      </span>
      <span className="min-w-0">
        <code className="text-[12.5px] text-ink">{label}</code>
        <span className="ml-2 text-[12px] text-muted">{on ? 'set' : 'not set'}</span>
        <span className="block text-[11.5px] leading-[1.5] text-faint">{detail}</span>
      </span>
    </li>
  )
}

/**
 * WhatsApp Business settings (10 §2 Tier 2 · 06 §4).
 *
 * **Nothing here can show a secret.** Supabase secrets are readable only by
 * the edge functions, so every line below is the result of *probing* the
 * deployed function — an unauthenticated GET and POST against `wa-webhook`,
 * and a `status` call to `wa-send`. A 503 means the secret is missing, which
 * is a supported state, not an outage: Tier 1 (the wa.me link on every profile
 * plus Quick Capture) covers about 90% of the need and keeps working (10 §2).
 */
export function WhatsAppSettingsCard({ readOnly }: { readOnly: boolean }) {
  const config = useWaConfig()
  const templates = useWaTemplates()
  const sync = useSyncWaTemplates()

  const status = config.data
  const approved = (templates.data ?? []).filter((t) => (t.status ?? '').toUpperCase() === 'APPROVED')
  const connected = Boolean(status?.sendConfigured)

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <SectionLabel>Connection</SectionLabel>
        <div className="rounded-card border border-border bg-surface px-4 py-3">
          <p className="text-[13px] font-semibold">
            {config.isLoading
              ? 'Checking…'
              : connected
                ? 'WhatsApp Business is connected.'
                : 'WhatsApp Business is not connected — Tier 1 (wa.me + Quick Capture) is running.'}
          </p>
          <ul className="mt-2 flex flex-col gap-[2px]">
            <Line
              on={Boolean(status?.sendConfigured)}
              label="WA_ACCESS_TOKEN + WA_PHONE_NUMBER_ID"
              detail="probed by calling wa-send; 503 wa_unconfigured means one of them is missing"
            />
            <Line
              on={Boolean(status?.verifyTokenSet)}
              label="WA_VERIFY_TOKEN"
              detail="probed by the webhook’s GET handshake; 503 means unset, 403 means set"
            />
            <Line
              on={Boolean(status?.appSecretSet)}
              label="WA_APP_SECRET"
              detail="probed by an unsigned POST; 503 means unset, 401 means set and the signature was refused"
            />
            <Line
              on={Boolean(status?.templatesSyncable)}
              label="WA_BUSINESS_ACCOUNT_ID"
              detail="only needed for “Sync templates”"
            />
          </ul>
          {status?.probeError ? (
            <p className="mt-2 text-[11.5px] text-muted">Probe: {status.probeError}</p>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Meta app configuration</SectionLabel>
        <div className="rounded-card border border-border bg-surface px-4 py-3 text-[12.5px] leading-[1.55] text-muted">
          <p>
            In the Meta app under <strong>WhatsApp → Configuration → Webhook</strong>, press{' '}
            <strong>Edit</strong> and paste:
          </p>
          <dl className="mt-2 flex flex-col gap-[6px]">
            <div>
              <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-faint">
                Callback URL
              </dt>
              <dd>
                <code className="break-all text-ink">{status?.callbackUrl ?? '…'}</code>
              </dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-faint">
                Verify token
              </dt>
              <dd>
                the value stored as <code className="text-ink">WA_VERIFY_TOKEN</code> — Meta sends it back on{' '}
                <code className="text-ink">GET</code> and the function echoes{' '}
                <code className="text-ink">hub.challenge</code> only when it matches
              </dd>
            </div>
          </dl>
          <p className="mt-2">
            Then subscribe the app to the <strong>messages</strong> field. Every delivery after that carries{' '}
            <code className="text-ink">X-Hub-Signature-256</code>, which the function verifies against{' '}
            <code className="text-ink">WA_APP_SECRET</code> over the raw body before reading a single byte
            of it.
          </p>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Secrets</SectionLabel>
        <ul className="flex flex-col gap-[2px] rounded-card border border-border bg-surface px-4 py-3 text-[12px] text-muted">
          {SECRETS.map((secret) => (
            <li key={secret.name} className="py-[3px]">
              <code className="text-ink">{secret.name}</code> · {secret.what}
              <span className="block text-[11.5px] text-faint">{secret.where}</span>
            </li>
          ))}
        </ul>
        <p className="text-[11.5px] leading-[1.5] text-faint">
          Set them with <code>supabase secrets set …</code> or in the dashboard under Edge Functions →
          Secrets. They are never sent to the browser and cannot be viewed or changed from this screen.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Message templates</SectionLabel>
        <div className="rounded-card border border-border bg-surface px-4 py-3 text-[12.5px] text-muted">
          <p>
            {approved.length > 0
              ? `${approved.length} approved template${approved.length === 1 ? '' : 's'} on file.`
              : 'No approved templates yet.'}{' '}
            Templates are written and approved in{' '}
            <strong>Meta Business Manager → WhatsApp Manager → Message templates</strong>; this button only
            mirrors the catalogue.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            disabled={readOnly || sync.isPending}
            onClick={() => sync.mutate()}
          >
            {sync.isPending ? 'Syncing…' : 'Sync templates'}
          </Button>
          {sync.error ? (
            <p role="alert" className="mt-2 text-[12px] text-muted">
              {(sync.error as WaCallError).message ?? WA_NOTICE.error}
            </p>
          ) : null}
          {sync.isSuccess ? (
            <p className="mt-2 text-[12px] text-good">Synced {sync.data?.synced ?? 0} templates.</p>
          ) : null}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>What this costs and what the rules are</SectionLabel>
        <div className="rounded-card border border-border bg-surface px-4 py-3 text-[12.5px] leading-[1.55] text-muted">
          <p>
            <strong className="text-ink">The 24-hour window.</strong> You may write freely for 24 hours
            after a donor’s last message. Outside it, only templates Meta has approved — enforced in the
            composer and again in <code className="text-ink">wa-send</code>, which answers{' '}
            <code className="text-ink">409 window_closed</code> to anything else.
          </p>
          <p className="mt-2">
            <strong className="text-ink">Cost.</strong> Pricing is per message beyond the free allowance
            (Meta gives 1,000 free service conversations a month; UK marketing messages run around £0.04,
            utility cheaper). Sending a template to a list is a real bill, not a free broadcast.
          </p>
          <p className="mt-2">
            <strong className="text-ink">Opt-in.</strong> A donor must have agreed to be contacted on
            WhatsApp before you message them there. Record it as you would any other consent; Meta requires
            it and so does the ICO.
          </p>
          <p className="mt-2">
            <strong className="text-ink">Cloud API only.</strong> Unofficial bridges and WhatsApp Web
            scraping are permanently rejected (10 §2 Tier 3): they violate the terms and risk a ban on the
            fundraiser’s own number, which would damage the relationships themselves.
          </p>
        </div>
      </section>
    </div>
  )
}
