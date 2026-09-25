import { useState } from 'react'
import { SectionLabel } from '../../components'
import { cn } from '../../lib/cn'
import { emailInboundUrl, useEmailSetupStatus } from '../../lib/queries/comms'

export interface EmailTabProps {
  readOnly: boolean
}

function StatusLine({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 py-[3px]">
      <span
        className={cn(
          'text-[12.5px] font-semibold',
          ok === null ? 'text-faint' : ok ? 'text-good' : 'text-muted',
        )}
      >
        {ok === null ? '·' : ok ? '✓' : '✗'} {label}
      </span>
      <span className="text-[12.5px] text-muted">{detail}</span>
    </li>
  )
}

/**
 * Email settings (10 §3) — status, the URL to paste, and the three things an
 * admin has to do. Nothing on this screen can change a secret: they live as
 * Supabase secrets read only by the edge functions, exactly as the model key
 * does (see the AI tab), so the browser never holds one.
 *
 * The status is *probed*, not stored. `email-send` has a status mode that
 * answers what is configured without sending; `email-inbound` needs no mode at
 * all, because its two unauthenticated answers already are the question —
 * **503** means no inbound secret is set, **404** means one is (and ours, quite
 * rightly, is not it).
 *
 * Every member sees the status. Only an admin can act on it, and the write
 * that matters happens in the Supabase dashboard, not here (11 §1).
 */
export function EmailTab({ readOnly }: EmailTabProps) {
  const status = useEmailSetupStatus()
  const [copied, setCopied] = useState(false)

  const url = emailInboundUrl('YOUR_EMAIL_INBOUND_SECRET')
  const sendOk = status.data ? status.data.sendConfigured : null
  const inboundOk = status.data ? status.data.inboundConfigured : null

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <SectionLabel>Status</SectionLabel>
        <ul className="flex flex-col gap-[2px] rounded-card border border-border bg-surface px-4 py-3">
          {status.isPending ? (
            <li className="py-[3px] text-[12.5px] text-muted">Checking…</li>
          ) : (
            <>
              <StatusLine
                ok={sendOk}
                label="Sending"
                detail={
                  sendOk === null
                    ? 'could not be checked from this browser'
                    : sendOk
                      ? `configured — outbound mail leaves from ${status.data?.from ?? 'the configured address'}`
                      : 'not configured: RESEND_API_KEY and EMAIL_FROM are not both set. Compose still drafts; Send is disabled.'
                }
              />
              <StatusLine
                ok={inboundOk}
                label="Receiving"
                detail={
                  status.data?.inboundMissing
                    ? 'the email-inbound function did not answer — deploy it first'
                    : inboundOk
                      ? 'configured — the webhook is live and rejecting callers without the secret'
                      : 'not configured: EMAIL_INBOUND_SECRET is not set, so the webhook answers 503 and files nothing'
                }
              />
            </>
          )}
        </ul>
        <p className="text-[11.5px] leading-[1.5] text-faint">
          Neither secret is readable from this screen, or from any build of this app. They are Supabase
          secrets read only by the two edge functions; rotate them in the Supabase dashboard.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Inbound webhook URL</SectionLabel>
        <div className="flex flex-col gap-2 rounded-card border border-border bg-surface px-4 py-3">
          <code className="overflow-x-auto rounded-input bg-ground px-3 py-2 text-[11.5px] break-all text-nav">
            {url}
          </code>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void copyUrl()}
              className="text-[12px] font-semibold text-accent hover:text-accent-dark"
            >
              {copied ? 'Copied' : 'Copy URL'}
            </button>
            <span className="text-[11.5px] text-faint">
              Replace <code>YOUR_EMAIL_INBOUND_SECRET</code> with the value you set on the project.
            </span>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>Setting it up</SectionLabel>
        <ol className="flex list-decimal flex-col gap-[6px] rounded-card border border-border bg-surface py-3 pr-4 pl-8 text-[12.5px] text-nav">
          <li>
            Verify the sending domain at Resend and create an API key with send permission.
          </li>
          <li>
            On the Supabase project, set the secrets <code>RESEND_API_KEY</code>,{' '}
            <code>EMAIL_FROM</code> (e.g. <code>office@yeshiva.org</code>) and{' '}
            <code>EMAIL_INBOUND_SECRET</code> (any long random string).
          </li>
          <li>
            Paste the URL above — with your secret in place of the placeholder — as the inbound webhook in
            the Resend dashboard.
          </li>
        </ol>
        {readOnly ? (
          <p className="text-[11.5px] text-faint">
            You can see the status; an admin performs these three steps. The database and the edge
            functions enforce that, not this screen (11 §1).
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>What it does and does not do</SectionLabel>
        <div className="rounded-card border border-border bg-surface px-4 py-3 text-[12.5px] text-muted">
          <p>
            Received mail lands in the Inbox and is matched to a contact by the sender's address. Matching
            ignores capitals and plus-addressing, so <code>Donor+crm@x.com</code> reaches the same donor as{' '}
            <code>donor@x.com</code>.
          </p>
          <p className="mt-2">
            An email is <em>not</em> a timeline entry. It becomes one only when somebody presses{' '}
            <b>Log to timeline</b>, which writes an ordinary interaction against a contact (10 §1: no shadow
            inboxes).
          </p>
          <p className="mt-2">
            Nothing sends by itself. Every outbound message comes from a person pressing Send, carrying
            their own credentials (I-10).
          </p>
        </div>
      </section>
    </div>
  )
}
