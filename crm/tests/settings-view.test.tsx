/**
 * Settings (06 §4) — the five tabs, and the role gate over them.
 *
 * The gate is a *reflection* of the RLS matrix, never its implementation
 * (11 §2): a non-admin sees the same configuration read-only. These tests
 * assert both halves — that an admin's edits reach the tables, and that a
 * fundraiser's controls are disabled while the information stays visible.
 * The database's own refusal is proven separately, against the live project,
 * in `tests/acceptance/rls.live.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../src/lib/supabase', async () => {
  const harness = await import('./support/harness')
  return { supabase: harness.supabase, isConfigured: true }
})
vi.mock('../src/lib/env', () => ({
  SUPABASE_URL: 'http://fake.local',
  SUPABASE_ANON_KEY: 'fake',
  isConfigured: true,
}))

const { IDS, MONDAY, seededMondayTables } = await import('./acceptance/fixtures')
const { freezeClock, installWorld, renderApp, resetWorld, thawClock } = await import('./support/harness')
const { RULE_SCHEMAS, AI_FEATURES } = await import('../src/features/settings/ruleSchemas')

type Row = Record<string, unknown>

/** The seeded world plus the extra team members the Team tab needs. */
function settingsWorld(role: 'admin' | 'fundraiser' = 'admin') {
  const tables = seededMondayTables()
  tables.team_members = [
    {
      id: IDS.braun,
      full_name: "R' Braun",
      email: 'admin@demo.test',
      role,
      can_see_amounts: true,
      digest_hour: 7,
      digest_channel: 'email',
      is_active: true,
    },
    {
      id: 'member-viewer',
      full_name: 'Shaindy Viewer',
      email: 'viewer@demo.test',
      role: 'viewer',
      can_see_amounts: false,
      digest_hour: 8,
      digest_channel: 'none',
      is_active: true,
    },
  ]
  return tables
}

const openTab = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(await screen.findByRole('tab', { name }))
}

/** The picker opens on the first list alphabetically; these tests want `stage`. */
const chooseStageList = async (user: ReturnType<typeof userEvent.setup>) => {
  const picker = await screen.findByLabelText('Lookup list', {}, { timeout: 5000 })
  // The options arrive with the `list_name` query; wait for them before choosing.
  await within(picker).findByRole('option', { name: 'Stage' }, { timeout: 5000 })
  await user.selectOptions(picker, 'stage')
  return picker
}

describe('settings · admin', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('shows all five sections and marks the role', async () => {
    installWorld({ tables: settingsWorld() })
    await renderApp('/settings')

    await screen.findByRole('heading', { level: 1, name: 'Settings' })
    for (const tab of ['Lookups', 'Automation rules', 'Team', 'Organisation', 'AI']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument()
    }
    expect(await screen.findByText('Admin')).toBeInTheDocument()
    expect(screen.queryByText(/only an admin can change it/)).toBeNull()
  })

  it('edits a lookup option in place, and writes it', async () => {
    const world = installWorld({ tables: settingsWorld() })
    const user = userEvent.setup()
    await renderApp('/settings')

    await chooseStageList(user)
    const label = await screen.findByLabelText('Label for prospect', {}, { timeout: 5000 })
    await user.clear(label)
    await user.type(label, 'Possible donor')
    await user.tab()

    await waitFor(() => {
      const row = (world.tables.lookup_options as Row[]).find(
        (option) => option.list_name === 'stage' && option.value === 'prospect',
      )
      expect(row?.label).toBe('Possible donor')
    })
  })

  it('retires an option rather than deleting it (02 §6)', async () => {
    const world = installWorld({ tables: settingsWorld() })
    const user = userEvent.setup()
    await renderApp('/settings')

    await chooseStageList(user)
    const toggle = await screen.findByLabelText('cultivation is active', {}, { timeout: 5000 })
    await user.click(toggle)

    await waitFor(() => {
      const row = (world.tables.lookup_options as Row[]).find((option) => option.value === 'cultivation')
      expect(row?.is_active).toBe(false)
      // Still there — the history that used it stays readable.
      expect(row).toBeTruthy()
    })
  })

  it('adds an option, deriving its stored value from the label', async () => {
    const world = installWorld({ tables: settingsWorld() })
    const user = userEvent.setup()
    await renderApp('/settings')

    await chooseStageList(user)
    const field = await screen.findByLabelText('New option label', {}, { timeout: 5000 })
    await user.type(field, 'Shul committee')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      const row = (world.tables.lookup_options as Row[]).find((option) => option.value === 'shul_committee')
      expect(row?.label).toBe('Shul committee')
      expect(row?.list_name).toBe('stage')
      expect(row?.is_active).toBe(true)
    })
  })

  it('renders every automation rule with a plain-English description (08 §7)', async () => {
    installWorld({ tables: settingsWorld() })
    const user = userEvent.setup()
    await renderApp('/settings')
    await openTab(user, /Automation rules/)

    for (const key of ['kit_due', 'thank_you_on_gift', 'neglect_flags']) {
      const schema = RULE_SCHEMAS[key]
      expect(schema, `no schema declared for ${key}`).toBeTruthy()
      expect(await screen.findByText(schema!.label)).toBeInTheDocument()
      expect(screen.getByText(schema!.description)).toBeInTheDocument()
    }
    // The switch is a switch, and the law it obeys is stated on the page.
    expect(screen.getByRole('switch', { name: /Keep-in-touch tasks enabled/ })).toBeInTheDocument()
    expect(screen.getByText(/never send anything to a donor/i)).toBeInTheDocument()
  })

  it('toggles a rule and retunes its parameters', async () => {
    const world = installWorld({ tables: settingsWorld() })
    const user = userEvent.setup()
    await renderApp('/settings')
    await openTab(user, /Automation rules/)

    await user.click(await screen.findByRole('switch', { name: /Keep-in-touch tasks enabled/ }))
    await waitFor(() => {
      const rule = (world.tables.automation_rules as Row[]).find((row) => row.rule_key === 'kit_due')
      expect(rule?.is_enabled).toBe(false)
    })

    const threshold = screen.getByLabelText('Big gift')
    await user.clear(threshold)
    await user.type(threshold, '750')
    await user.tab()

    await waitFor(() => {
      const rule = (world.tables.automation_rules as Row[]).find(
        (row) => row.rule_key === 'thank_you_on_gift',
      )
      expect((rule?.params as Record<string, unknown>).big_gift_threshold).toBe(750)
      // Retuning one parameter must not wipe its siblings.
      expect((rule?.params as Record<string, unknown>).major_gift_threshold).toBe(5000)
    })
  })

  it('falls back to read-only JSON for a rule it has no schema for', async () => {
    const tables = settingsWorld()
    ;(tables.automation_rules as Row[]).push({
      rule_key: 'future_rule_nobody_wrote_yet',
      is_enabled: true,
      params: { threshold: 42 },
      updated_at: null,
    })
    installWorld({ tables })
    const user = userEvent.setup()
    await renderApp('/settings')
    await openTab(user, /Automation rules/)

    // The key stands in for a label it has no schema for, so it appears twice.
    expect((await screen.findAllByText('future_rule_nobody_wrote_yet')).length).toBeGreaterThan(0)
    expect(screen.getByText(/No description written for this rule yet/)).toBeInTheDocument()
    expect(screen.getByText(/"threshold": 42/)).toBeInTheDocument()
  })

  it('manages the team, and refuses to let an admin demote themselves', async () => {
    const world = installWorld({ tables: settingsWorld() })
    const user = userEvent.setup()
    await renderApp('/settings')
    await openTab(user, /Team/)

    // Own row: labelled, and not role-editable.
    expect(await screen.findByText('You')).toBeInTheDocument()
    expect(screen.getByLabelText("Role for R' Braun")).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Role for Shaindy Viewer'), 'fundraiser')
    await waitFor(() => {
      const member = (world.tables.team_members as Row[]).find((row) => row.id === 'member-viewer')
      expect(member?.role).toBe('fundraiser')
    })
  })

  it('offers can_see_amounts only where it means something', async () => {
    installWorld({ tables: settingsWorld() })
    const user = userEvent.setup()
    await renderApp('/settings')
    await openTab(user, /Team/)

    // A viewer's amounts toggle exists; an admin's does not — they always see.
    expect(await screen.findByLabelText('Shaindy Viewer can see amounts')).toBeInTheDocument()
    expect(screen.queryByLabelText("R' Braun can see amounts")).toBeNull()
    expect(screen.getAllByTitle(/always see amounts/i).length).toBeGreaterThan(0)
  })

  it('stores organisation details where the Gift Aid export can find them', async () => {
    const world = installWorld({ tables: settingsWorld() })
    const user = userEvent.setup()
    await renderApp('/settings')
    await openTab(user, /Organisation/)

    // `Field` puts its hint inside the label, so the lookups match on a prefix.
    await user.type(await screen.findByLabelText(/^Charity number/, {}, { timeout: 5000 }), '1122334')
    await user.type(screen.getByLabelText(/^HMRC reference/), 'AB12345')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const row = (world.tables.automation_rules as Row[]).find((rule) => rule.rule_key === 'org_details')
      const params = row?.params as Record<string, unknown>
      expect(params?.charity_number).toBe('1122334')
      expect(params?.hmrc_reference).toBe('AB12345')
    })
  })

  it('switches AI features individually, and says where the key lives', async () => {
    const world = installWorld({ tables: settingsWorld() })
    const user = userEvent.setup()
    await renderApp('/settings')
    await openTab(user, /^AI$/)

    for (const feature of AI_FEATURES) {
      expect(await screen.findByRole('switch', { name: `${feature.label} enabled` })).toBeChecked()
    }

    await user.click(screen.getByRole('switch', { name: 'Message drafting enabled' }))
    await waitFor(() => {
      const row = (world.tables.automation_rules as Row[]).find((rule) => rule.rule_key === 'ai_features')
      const params = row?.params as Record<string, boolean>
      expect(params.drafting).toBe(false)
      // The others are written explicitly rather than dropped.
      expect(params.quick_capture_parse).toBe(true)
    })

    expect(screen.getByText('ANTHROPIC_API_KEY')).toBeInTheDocument()
    expect(screen.getByText(/never sent to the browser/i)).toBeInTheDocument()
    expect(screen.getByText(/requesting user’s/)).toBeInTheDocument()
  })
})

describe('settings · non-admin', () => {
  beforeEach(() => {
    freezeClock(MONDAY)
    window.localStorage.clear()
    installWorld({ tables: settingsWorld('fundraiser') })
  })

  afterEach(() => {
    thawClock()
    resetWorld()
    vi.clearAllMocks()
  })

  it('shows the same configuration, read-only, and says who can change it', async () => {
    const user = userEvent.setup()
    await renderApp('/settings')
    await screen.findByRole('heading', { level: 1, name: 'Settings' })

    expect(await screen.findByText('Read only')).toBeInTheDocument()
    expect(screen.getByText(/only an admin can change it/)).toBeInTheDocument()
    // The database enforces it; this screen only reflects it (11 §2).
    expect(screen.getByText(/The database enforces this/)).toBeInTheDocument()

    await chooseStageList(user)
    const label = await screen.findByLabelText('Label for prospect', {}, { timeout: 5000 })
    expect(label).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull()
  })

  it('disables the rule switches without hiding the rules', async () => {
    const user = userEvent.setup()
    await renderApp('/settings')
    await openTab(user, /Automation rules/)

    const toggle = await screen.findByRole('switch', { name: /Keep-in-touch tasks enabled/ })
    expect(toggle).toBeDisabled()
    expect(screen.getByText(RULE_SCHEMAS.kit_due!.description)).toBeInTheDocument()
  })

  it('leaves the organisation form visible but unsavable', async () => {
    const user = userEvent.setup()
    await renderApp('/settings')
    await openTab(user, /Organisation/)

    expect(await screen.findByLabelText(/^Charity number/, {}, { timeout: 5000 })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })
})

describe('settings · rule schema coverage (08 §2–§3)', () => {
  it('declares a schema for every rule the spec names', () => {
    const specKeys = [
      'thank_you_on_gift',
      'receipt_on_gift',
      'first_gift_call',
      'gift_aid_evaluate',
      'ga_declaration_chase',
      'household_soft_credit',
      'influencer_prompt',
      'tribute_acknowledgee',
      'stage_change_prompts',
      'pledge_schedule',
      'kit_due',
      'proposal_follow_up',
      'pledge_chase',
      'recurring_failing',
      'neglect_flags',
      'engagement_recompute',
      'donor_status_recompute',
      'meeting_reminder',
      'stale_prospects',
      'auto_tags',
      'rfm_recompute',
      'no_next_action_audit',
      'duplicate_scan',
    ]
    for (const key of specKeys) {
      const schema = RULE_SCHEMAS[key]
      expect(schema, `08 names \`${key}\` but no schema is declared`).toBeTruthy()
      expect(schema!.description.length, `${key} has no plain-English description`).toBeGreaterThan(30)
    }
  })
})
