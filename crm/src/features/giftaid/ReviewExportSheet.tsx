import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { Button, Sheet, TextInput } from '../../components'
import { cn } from '../../lib/cn'
import { formatDate, formatMoney, formatNumber } from '../../lib/format'
import {
  claimableLines,
  excludeReasonLabel,
  hmrcCsv,
  hmrcFilename,
  houseNumber,
  summariseValidation,
  type ValidationGroup,
} from './logic'
import type { ClaimLine, ClaimTotalsRow, GaContactRow, ValidationFailure } from './types'

export type ReviewStep = 'review' | 'confirm-export' | 'submit' | 'done'

export interface ReviewExportSheetProps {
  open: boolean
  onClose: () => void
  claim: ClaimTotalsRow | null
  lines: ClaimLine[]
  failures: ValidationFailure[]
  loading?: boolean
  /** Held-back gifts, so a wrong exclusion can be undone from the same screen. */
  excluded: ClaimLine[]
  amountsHidden: boolean
  onFixAddress: (input: { contactId: string; postcode?: string; gaHouseNo?: string }) => Promise<void> | void
  onSetExcluded: (input: { giftId: string; contactId: string; excluded: boolean; reason?: string }) => Promise<void> | void
  onDownload: (filename: string, csv: string) => void
  onSubmit: (reference: string) => Promise<void>
  submitting?: boolean
  submitError?: string | null
}

/** One inline fix row: type the value, one click writes it to the donor. */
function AddressFix({
  label,
  placeholder,
  initial,
  onSave,
}: {
  label: string
  placeholder: string
  initial: string
  onSave: (value: string) => Promise<void> | void
}) {
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  useEffect(() => setValue(initial), [initial])

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <span className="whitespace-nowrap">{label}</span>
        <TextInput
          value={value}
          placeholder={placeholder}
          aria-label={label}
          className="w-[150px] py-[5px] text-[12.5px]"
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
      <Button
        variant="accentOutline"
        size="sm"
        disabled={value.trim() === '' || saving}
        onClick={() => {
          setSaving(true)
          void Promise.resolve(onSave(value.trim())).finally(() => setSaving(false))
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

/**
 * Review & export (05 §5, 07 §8.2) — **desktop, admin, precision work**.
 *
 * The order is the spec's: validate → fix the rows one click at a time →
 * generate the HMRC Charities Online schedule → file it and record the
 * reference. The file leaves the system, so the download is a confirm
 * (03 §5.2 / I-12); filing the claim is irreversible, so it says so.
 *
 * Nothing is exported while a row would be rejected: a Charities Online file
 * fails as a whole, so a "mostly valid" claim is not a useful thing to produce.
 */
export function ReviewExportSheet({
  open,
  onClose,
  claim,
  lines,
  failures,
  loading,
  excluded,
  amountsHidden,
  onFixAddress,
  onSetExcluded,
  onDownload,
  onSubmit,
  submitting,
  submitError,
}: ReviewExportSheetProps) {
  const [step, setStep] = useState<ReviewStep>('review')
  const [reference, setReference] = useState('')

  useEffect(() => {
    if (!open) return
    setStep('review')
    setReference('')
  }, [open])

  const summary = useMemo(() => summariseValidation(failures), [failures])
  const exportable = useMemo(() => claimableLines(lines), [lines])
  const csv = useMemo(() => hmrcCsv(exportable), [exportable])
  const filename = hmrcFilename()

  const money = (amount: number | null | undefined) =>
    amountsHidden ? '—' : formatMoney(amount === null || amount === undefined ? null : Number(amount))

  const contactOf = (group: ValidationGroup): GaContactRow | null =>
    lines.find((line) => line.gift.id === group.donationId)?.contact ?? null

  const title =
    step === 'done'
      ? 'Claim filed'
      : step === 'submit'
        ? 'Record the submission'
        : step === 'confirm-export'
          ? 'Download the HMRC schedule'
          : 'Review & export — Gift Aid claim'

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      width={940}
      leading={
        step === 'review' || step === 'done' ? (
          <button type="button" onClick={onClose} className="text-muted hover:text-ink">
            {step === 'done' ? 'Done' : 'Close'}
          </button>
        ) : (
          <button type="button" onClick={() => setStep('review')} className="text-muted hover:text-ink">
            Back
          </button>
        )
      }
      footer={
        step === 'review' ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              className="grow"
              disabled={!summary.ready || exportable.length === 0}
              onClick={() => setStep('confirm-export')}
            >
              Generate HMRC CSV →
            </Button>
            {!summary.ready ? (
              <span className="text-[12.5px] text-flag-today-ink">
                Fix or exclude the {formatNumber(summary.giftCount)} blocked gift
                {summary.giftCount === 1 ? '' : 's'} first — HMRC rejects the file as a whole.
              </span>
            ) : exportable.length === 0 ? (
              <span className="text-[12.5px] text-muted">Nothing to claim yet.</span>
            ) : (
              <span className="text-[12.5px] text-good">
                {formatNumber(exportable.length)} rows validated — ready to file.
              </span>
            )}
          </div>
        ) : step === 'confirm-export' ? (
          <div className="flex gap-2">
            <Button variant="outline" className="grow" onClick={() => setStep('review')}>
              Keep as it is
            </Button>
            <Button
              className="grow"
              onClick={() => {
                onDownload(filename, csv)
                setStep('submit')
              }}
            >
              Download {filename}
            </Button>
          </div>
        ) : step === 'submit' ? (
          <div className="flex gap-2">
            <Button variant="outline" className="grow" onClick={() => setStep('review')}>
              Not yet
            </Button>
            <Button
              variant="danger"
              className="grow"
              disabled={reference.trim() === '' || submitting}
              onClick={() => {
                void onSubmit(reference.trim()).then(() => setStep('done'))
              }}
            >
              {submitting ? 'Filing…' : 'Record submission'}
            </Button>
          </div>
        ) : (
          <Button className="w-full" onClick={onClose}>
            Back to the workspace
          </Button>
        )
      }
    >
      {step === 'review' ? (
        <div className="flex flex-col gap-4">
          <dl className="tabular grid grid-cols-2 gap-3 rounded-card border border-border bg-ground px-4 py-3 text-[13px] sm:grid-cols-4">
            <div>
              <dt className="text-[11.5px] font-semibold text-muted uppercase">Gifts</dt>
              <dd className="text-[18px] font-bold">{formatNumber(Number(claim?.gift_count ?? 0))}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold text-muted uppercase">Donations</dt>
              <dd className="text-[18px] font-bold">{money(claim?.donations_total)}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold text-muted uppercase">Claimable +25%</dt>
              <dd className="text-[18px] font-bold text-gold">{money(claim?.claimable_total)}</dd>
            </div>
            <div>
              <dt className="text-[11.5px] font-semibold text-muted uppercase">GASDS</dt>
              <dd className="text-[18px] font-bold">{money(claim?.gasds_total)}</dd>
            </div>
          </dl>

          <section className="flex flex-col gap-2">
            <h3 className="text-[12px] font-bold tracking-[0.06em] text-muted uppercase">
              Validation {loading ? '· checking…' : summary.ready ? '· all clear' : `· ${summary.giftCount} to fix`}
            </h3>

            {summary.ready && !loading ? (
              <p className="rounded-card bg-good-bg px-4 py-3 text-[13px] text-good">
                Every gift on this claim has a covering declaration, a sterling amount, an individual donor and an
                address HMRC can match.
              </p>
            ) : null}

            {summary.groups.map((group) => {
              const contact = contactOf(group)
              const codes = new Set(group.failures.map((failure) => failure.code))
              return (
                <div
                  key={group.donationId}
                  className="flex flex-col gap-2 rounded-card border border-flag-today/40 bg-surface px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
                    <span>
                      <Link to={`/contacts/${group.contactId}`} className="font-semibold text-ink hover:text-accent">
                        {group.donorName}
                      </Link>
                      <span className="text-muted">
                        {' '}
                        · {formatDate(group.donatedOn)} · {money(group.amountGbp)}
                      </span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void onSetExcluded({
                          giftId: group.donationId,
                          contactId: group.contactId,
                          excluded: true,
                          reason: [...codes].join(', '),
                        })
                      }
                    >
                      Exclude this gift
                    </Button>
                  </div>

                  <ul className="flex flex-col gap-2">
                    {group.failures.map((failure) => (
                      <li key={failure.code} className="flex flex-wrap items-center gap-3 text-[12.5px]">
                        <span className="text-flag-today-ink">{failure.message}</span>
                        {failure.code === 'missing_postcode' ? (
                          <AddressFix
                            label="Postcode"
                            placeholder="NW11 8AA"
                            initial={contact?.postcode ?? ''}
                            onSave={(value) => onFixAddress({ contactId: group.contactId, postcode: value })}
                          />
                        ) : null}
                        {failure.code === 'missing_house_no' ? (
                          <AddressFix
                            label="House name/number"
                            placeholder="12"
                            initial={houseNumber(contact)}
                            onSave={(value) => onFixAddress({ contactId: group.contactId, gaHouseNo: value })}
                          />
                        ) : null}
                        {failure.code === 'no_declaration' ? (
                          <Link
                            to={`/contacts/${group.contactId}`}
                            className="text-[12.5px] font-semibold text-accent hover:text-accent-dark"
                          >
                            Record a declaration →
                          </Link>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              )
            })}
          </section>

          {excluded.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-[12px] font-bold tracking-[0.06em] text-muted uppercase">
                Held back · {formatNumber(excluded.length)}
              </h3>
              {excluded.map((line) => (
                <div
                  key={line.gift.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-row bg-ground px-4 py-2 text-[12.5px]"
                >
                  <span>
                    <b>{line.contact ? `${line.contact.first_name} ${line.contact.last_name ?? ''}`.trim() : 'Donor'}</b>
                    <span className="text-muted">
                      {' '}
                      · {formatDate(line.gift.donated_on)} · {money(line.gift.amount_gbp)}
                      {excludeReasonLabel(line.gift.ga_exclude_reason)
                        ? ` · ${excludeReasonLabel(line.gift.ga_exclude_reason)}`
                        : ''}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void onSetExcluded({
                        giftId: line.gift.id,
                        contactId: line.gift.contact_id,
                        excluded: false,
                      })
                    }
                  >
                    Put back on the claim
                  </Button>
                </div>
              ))}
            </section>
          ) : null}
        </div>
      ) : null}

      {step === 'confirm-export' ? (
        <div className="flex flex-col gap-3 text-[13px] leading-[1.5] text-nav">
          <p>
            This writes <b>{filename}</b> to your computer — {formatNumber(exportable.length)} donation rows worth{' '}
            <b className="text-gold">{money(claim?.claimable_total)}</b> in relief, in HMRC&apos;s Charities Online
            column order.
          </p>
          <p>
            The file leaves the CRM, so nothing here can take it back. Upload it to Charities Online, then come back and
            record the reference HMRC gives you.
          </p>
          <pre className="max-h-[220px] overflow-auto rounded-card border border-border bg-ground px-3 py-2 text-[11.5px] whitespace-pre">
            {csv.split('\r\n').slice(0, 6).join('\n')}
            {exportable.length > 5 ? `\n… ${formatNumber(exportable.length - 5)} more rows` : ''}
          </pre>
        </div>
      ) : null}

      {step === 'submit' ? (
        <div className="flex flex-col gap-3 text-[13px] leading-[1.5] text-nav">
          <p>
            Once you record the reference, all {formatNumber(Number(claim?.gift_count ?? 0))} gifts on this claim are
            stamped <b>claimed</b>, the claim is closed at{' '}
            <b className="text-gold">{money(claim?.claimable_total)}</b>, and a fresh rolling claim opens for the next
            gift. This cannot be undone from the app.
          </p>
          <label className="flex flex-col gap-[6px]">
            <span className="text-[12px] font-semibold text-muted">HMRC reference</span>
            <TextInput
              value={reference}
              autoFocus
              placeholder="CO-88214"
              aria-label="HMRC reference"
              onChange={(event) => setReference(event.target.value)}
            />
          </label>
          {submitError ? (
            <p role="alert" className={cn('rounded-card bg-[#FBECEC] px-3 py-2 text-[12.5px] text-flag-overdue')}>
              {submitError}
            </p>
          ) : null}
        </div>
      ) : null}

      {step === 'done' ? (
        <div className="flex flex-col gap-3 text-[13px] leading-[1.5] text-nav">
          <p className="rounded-card bg-good-bg px-4 py-3 text-good">
            Filed. The gifts are stamped <b>claimed</b> and a fresh rolling claim is already open — the next eligible
            gift joins it automatically.
          </p>
          <p>
            The claim now sits in the history below with its reference. When HMRC pays, mark it paid there and the
            quarter is closed.
          </p>
        </div>
      ) : null}
    </Sheet>
  )
}
