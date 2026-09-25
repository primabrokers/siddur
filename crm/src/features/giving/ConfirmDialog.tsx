import type { ReactNode } from 'react'
import { Button, Sheet } from '../../components'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  /** Say what will happen and why it cannot be undone. */
  children: ReactNode
  confirmLabel?: string
  /** `danger` for irreversible writes, `primary` for an export. */
  tone?: 'danger' | 'primary'
  pending?: boolean
  disabled?: boolean
}

/**
 * The rare confirm (I-12 / 03 §5.2): only for bulk mutations, irreversible
 * writes and anything that leaves the system. Everything else in this app gets
 * a 6-second undo toast instead.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirm',
  tone = 'danger',
  pending,
  disabled,
}: ConfirmDialogProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      width={440}
      leading={
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">
          Cancel
        </button>
      }
      footer={
        <div className="flex gap-2">
          <Button variant="outline" className="grow" onClick={onClose}>
            Keep as it is
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            className="grow"
            disabled={pending || disabled}
            onClick={onConfirm}
          >
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 text-[13px] leading-[1.5] text-nav">{children}</div>
    </Sheet>
  )
}
