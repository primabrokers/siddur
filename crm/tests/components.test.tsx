import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Avatar,
  FLAG_ORDER,
  FlagDot,
  MetricCard,
  NudgeCard,
  PersonRow,
  Pill,
  RewardState,
  SectionLabel,
  Sheet,
  TimelineEntry,
  ToastProvider,
  UNDO_MS,
  useUndoToast,
  type FlagVariant,
} from '../src/components'

describe('FlagDot', () => {
  it('renders one dot per flag variant with its meaning as the label', () => {
    const variants: FlagVariant[] = ['overdue', 'today', 'none', 'waiting', 'future', 'queued']
    for (const variant of variants) {
      const { unmount } = render(<FlagDot variant={variant} />)
      expect(screen.getByRole('img')).toHaveAttribute('data-flag', variant)
      unmount()
    }
  })

  it('renders queued as a dashed ring rather than a fill', () => {
    render(<FlagDot variant="queued" />)
    expect(screen.getByRole('img').className).toContain('border-dashed')
  })

  it('sorts red → orange → yellow → blue → grey, with yellow worse than grey (I-3)', () => {
    const sorted = (['future', 'waiting', 'none', 'today', 'overdue', 'queued'] as FlagVariant[]).sort(
      (a, b) => FLAG_ORDER[a] - FLAG_ORDER[b],
    )
    expect(sorted).toEqual(['overdue', 'today', 'none', 'waiting', 'future', 'queued'])
    expect(FLAG_ORDER.none).toBeLessThan(FLAG_ORDER.future)
  })
})

describe('Pill', () => {
  it('marks manual pills as filled and clickable (I-7)', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <Pill variant="manual" onClick={onClick}>
        In discussion
      </Pill>,
    )
    await user.click(screen.getByRole('button', { name: 'In discussion' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('marks computed pills as read-only outlines', () => {
    render(<Pill variant="computed">Active donor</Pill>)
    const pill = screen.getByText('Active donor')
    expect(pill).toHaveAttribute('data-pill', 'computed')
    expect(pill.className).toContain('border')
  })
})

describe('cards and rows', () => {
  it('renders a metric card with label, value and caption', () => {
    render(<MetricCard label="Donor retention" value="61%" caption="sector ≈43%" />)
    expect(screen.getByText('Donor retention')).toBeInTheDocument()
    expect(screen.getByText('61%')).toBeInTheDocument()
    expect(screen.getByText('sector ≈43%')).toBeInTheDocument()
  })

  it('renders a person row with flag, subtitle and chips', () => {
    render(
      <PersonRow
        name="Dovid Cohen"
        subtitle="Call re proposal — was due Thu"
        flag="overdue"
        chips={<Pill>12d since contact</Pill>}
      />,
    )
    expect(screen.getByText('Dovid Cohen')).toBeInTheDocument()
    expect(screen.getByText('Call re proposal — was due Thu')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Next action overdue' })).toBeInTheDocument()
    expect(screen.getByText('12d since contact')).toBeInTheDocument()
  })

  it('renders a timeline entry with its meta line and body', () => {
    render(
      <TimelineEntry title="Meeting · 11 Aug 2026" meta="logged by R' Braun">
        Met in London.
      </TimelineEntry>,
    )
    expect(screen.getByText('Meeting · 11 Aug 2026')).toBeInTheDocument()
    expect(screen.getByText('Met in London.')).toBeInTheDocument()
  })

  it('renders a nudge card with its accent title and actions', () => {
    render(
      <NudgeCard title="First gift this week" accent="accent" actions={<button type="button">Call now</button>}>
        The Klein family gave on Sunday.
      </NudgeCard>,
    )
    expect(screen.getByRole('heading', { name: 'First gift this week' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Call now' })).toBeInTheDocument()
  })

  it('renders the quiet reward state for the done-for-today moment', () => {
    render(<RewardState />)
    expect(screen.getByRole('heading', { name: "Everyone's taken care of today" })).toBeInTheDocument()
  })

  it('renders section labels and initials avatars', () => {
    render(
      <>
        <SectionLabel tone="overdue">Overdue · 4</SectionLabel>
        <Avatar name="Reuven Adler" />
      </>,
    )
    expect(screen.getByText('Overdue · 4')).toBeInTheDocument()
    expect(screen.getByText('RA')).toBeInTheDocument()
  })
})

describe('Sheet', () => {
  it('traps focus, closes on Escape and closes on the backdrop', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Sheet open onClose={onClose} title="Log interaction">
        <button type="button">Save</button>
      </Sheet>,
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()

    await user.click(screen.getByTestId('sheet-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})

describe('useUndoToast (CLAUDE.md rule 4 / I-12)', () => {
  function Harness({
    perform,
    undo,
    durationMs,
  }: {
    perform: () => void
    undo: () => void
    durationMs?: number
  }) {
    const withUndo = useUndoToast()
    return (
      <button
        type="button"
        onClick={() =>
          void withUndo({
            message: 'Task completed',
            perform: () => {
              perform()
              return 'task-1'
            },
            undo,
            ...(durationMs === undefined ? {} : { durationMs }),
          })
        }
      >
        Complete
      </button>
    )
  }

  it('defaults the undo window to 6 seconds', () => {
    expect(UNDO_MS).toBe(6000)
  })

  it('runs the mutation immediately and reverses it when Undo is tapped', async () => {
    const user = userEvent.setup()
    const perform = vi.fn()
    const undo = vi.fn()

    render(
      <ToastProvider>
        <Harness perform={perform} undo={undo} />
      </ToastProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Complete' }))
    expect(perform).toHaveBeenCalledOnce()
    expect(await screen.findByText('Task completed')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledWith('task-1')
    await waitFor(() => expect(screen.queryByTestId('toast')).not.toBeInTheDocument())
  })

  it('dismisses itself after the window without undoing', async () => {
    const user = userEvent.setup()
    const undo = vi.fn()

    render(
      <ToastProvider>
        <Harness perform={vi.fn()} undo={undo} durationMs={60} />
      </ToastProvider>,
    )

    await user.click(screen.getByRole('button', { name: 'Complete' }))
    expect(await screen.findByTestId('toast')).toBeInTheDocument()

    await waitFor(() => expect(screen.queryByTestId('toast')).not.toBeInTheDocument())
    expect(undo).not.toHaveBeenCalled()
  })
})
