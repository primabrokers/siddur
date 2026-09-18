import type { NoteRow } from './types'

export interface PinnedNoteBarProps {
  note: NoteRow | null | undefined
  onUnpin?: () => void
}

/**
 * The pinned note (04 §5.2) — "read this first", one per contact (D9), styled
 * distinctly per `DonorProfile.dc.html`.
 */
export function PinnedNoteBar({ note, onUnpin }: PinnedNoteBarProps) {
  if (!note) return null
  return (
    <div
      data-testid="pinned-note"
      className="flex items-start gap-[10px] rounded-card border border-[#EADFB8] bg-[#FFF9E8] px-[14px] py-[10px]"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 16 16"
        fill="none"
        stroke="#B08A00"
        strokeWidth="1.6"
        aria-hidden="true"
        className="mt-[3px] shrink-0"
      >
        <path d="M9.5 2 14 6.5l-3 1-2.5 4.5L4 7.5 8.5 5z" />
        <path d="M5.5 10.5 2.5 13.5" />
      </svg>
      <p className="min-w-0 grow text-[13px] leading-[1.45] text-[#6B5A26]">
        <b>Pinned:</b> {note.body}
      </p>
      {onUnpin ? (
        <button
          type="button"
          onClick={onUnpin}
          className="shrink-0 text-[11.5px] font-semibold text-[#6B5A26] underline underline-offset-2 hover:opacity-80"
        >
          Unpin
        </button>
      ) : null}
    </div>
  )
}
