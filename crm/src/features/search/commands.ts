/**
 * The Cmd/Ctrl+K command palette's action registry (03 §3).
 *
 * Superhuman's palette rules, adopted:
 *  - **fuzzy** subsequence matching with synonyms, so "log" finds "Quick
 *    capture" and "gift" finds "Record gift";
 *  - every action **displays its keyboard shortcut inline**, so the palette
 *    teaches the faster path rather than replacing it;
 *  - **context ranking**: actions belonging to the current route first, then
 *    the ones this person actually uses (localStorage counts), then the
 *    declared order.
 *
 * The registry is data. `CommandContext` supplies the effects, so the palette
 * itself dispatches into surfaces that already exist rather than reimplementing
 * any of them.
 */

import type { UsageCounts } from './recents'

export type CommandGroup = 'create' | 'navigate' | 'account'

export interface CommandContext {
  navigate: (to: string) => void
  openCapture: () => void
  signOut: () => void
}

export interface Command {
  id: string
  label: string
  group: CommandGroup
  /** Rendered on the right of the row — the shortcut this action also has. */
  shortcut?: string
  /** Extra words the fuzzy matcher accepts ("log" → Quick capture). */
  keywords?: string[]
  /** Route prefixes that make this action "current screen" for ranking. */
  routes?: string[]
  run: (ctx: CommandContext) => void
}

export const COMMAND_GROUP_LABEL: Record<CommandGroup, string> = {
  create: 'Create',
  navigate: 'Go to',
  account: 'Account',
}

/**
 * The palette's actions.
 *
 * TODO(giving): "Record gift" / "Record pledge" open the Giving screen with a
 * `?new=` intent because the gift and pledge sheets are local state inside
 * `features/giving/GivingView` with no exported opener; when one exists, call
 * it directly and drop the query parameter.
 */
export const COMMANDS: Command[] = [
  {
    id: 'contact.new',
    label: 'New contact',
    group: 'create',
    keywords: ['person', 'donor', 'add', 'create'],
    routes: ['/contacts'],
    run: (ctx) => ctx.navigate('/contacts?new=contact'),
  },
  {
    id: 'capture.open',
    label: 'Quick capture',
    group: 'create',
    shortcut: 'C',
    keywords: ['log', 'interaction', 'dictate', 'note', 'meeting'],
    routes: ['/', '/contacts'],
    run: (ctx) => ctx.openCapture(),
  },
  {
    id: 'gift.new',
    label: 'Record gift',
    group: 'create',
    keywords: ['donation', 'money', 'giving', 'payment'],
    routes: ['/giving'],
    run: (ctx) => ctx.navigate('/giving?new=gift'),
  },
  {
    id: 'pledge.new',
    label: 'Record pledge',
    group: 'create',
    keywords: ['promise', 'commitment', 'giving'],
    routes: ['/giving'],
    run: (ctx) => ctx.navigate('/giving?new=pledge'),
  },
  {
    id: 'task.new',
    label: 'New task',
    group: 'create',
    keywords: ['next action', 'todo', 'follow up', 'reminder'],
    routes: ['/tasks', '/'],
    run: (ctx) => ctx.navigate('/tasks?new=task'),
  },
  {
    id: 'go.today',
    label: 'Go to Today',
    group: 'navigate',
    shortcut: 'G T',
    keywords: ['action stream', 'start my day', 'home'],
    run: (ctx) => ctx.navigate('/'),
  },
  {
    id: 'go.contacts',
    label: 'Go to Contacts',
    group: 'navigate',
    shortcut: 'G C',
    keywords: ['people', 'donors', 'list', 'views'],
    run: (ctx) => ctx.navigate('/contacts'),
  },
  {
    id: 'go.giving',
    label: 'Go to Giving',
    group: 'navigate',
    shortcut: 'G G',
    keywords: ['gifts', 'money', 'pledges', 'thanks', 'receipts'],
    run: (ctx) => ctx.navigate('/giving'),
  },
  {
    id: 'go.tasks',
    label: 'Go to Tasks',
    group: 'navigate',
    shortcut: 'G K',
    keywords: ['todo', 'queue', 'next actions'],
    run: (ctx) => ctx.navigate('/tasks'),
  },
  {
    id: 'go.giftaid',
    label: 'Go to Gift Aid',
    group: 'navigate',
    keywords: ['declarations', 'hmrc', 'claim', 'ga'],
    run: (ctx) => ctx.navigate('/gift-aid'),
  },
  {
    id: 'go.import',
    label: 'Import contacts',
    group: 'navigate',
    keywords: ['csv', 'spreadsheet', 'upload', 'migrate'],
    run: (ctx) => ctx.navigate('/import'),
  },
  {
    id: 'go.settings',
    label: 'Go to Settings',
    group: 'navigate',
    shortcut: 'G S',
    keywords: ['admin', 'lookups', 'automation', 'team', 'ai'],
    run: (ctx) => ctx.navigate('/settings'),
  },
  {
    id: 'account.signout',
    label: 'Sign out',
    group: 'account',
    keywords: ['log out', 'leave', 'exit'],
    run: (ctx) => ctx.signOut(),
  },
]

/* ---------------------------------------------------------------- matching */

/**
 * Subsequence match with a bonus for contiguous runs and for hits at a word
 * start — enough fuzziness that "gtc" finds "Go to Contacts" without the
 * false positives a full edit-distance search brings.
 */
export function fuzzyScore(haystack: string, needle: string): number | null {
  const target = haystack.toLowerCase()
  const query = needle.toLowerCase().replace(/\s+/g, '')
  if (query === '') return 0
  if (query.length > target.length) return null

  let score = 0
  let cursor = 0
  let streak = 0
  for (const char of query) {
    const index = target.indexOf(char, cursor)
    if (index < 0) return null
    if (index === cursor && cursor > 0) {
      streak += 1
      score += 6 + streak
    } else {
      streak = 0
      score += 2
    }
    if (index === 0 || /[\s\-/]/.test(target[index - 1] ?? '')) score += 5
    cursor = index + 1
  }
  // Shorter targets are better matches for the same query.
  return score + Math.max(0, 20 - target.length)
}

export interface ScoredCommand {
  command: Command
  score: number
}

export interface RankOptions {
  /** Current pathname — actions declared for it rank first (context ranking). */
  pathname?: string
  usage?: UsageCounts
  limit?: number
}

const onRoute = (command: Command, pathname: string): boolean =>
  (command.routes ?? []).some((route) =>
    route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(`${route}/`),
  )

/**
 * Rank the palette. With no term this is the default suggestion list (03 §3:
 * "default suggestions before typing"); with a term the fuzzy score dominates
 * and context only breaks ties.
 */
export function rankCommands(term: string, options: RankOptions = {}): ScoredCommand[] {
  const { pathname = '/', usage = {}, limit = 8 } = options
  const query = term.trim()
  const out: ScoredCommand[] = []

  COMMANDS.forEach((command, index) => {
    let best: number | null = null
    const haystacks = [command.label, ...(command.keywords ?? [])]
    for (const haystack of haystacks) {
      const score = fuzzyScore(haystack, query)
      if (score === null) continue
      // Keyword hits are real but weaker than a label hit.
      const weighted = haystack === command.label ? score : score - 8
      if (best === null || weighted > best) best = weighted
    }
    if (best === null) return

    const contextBonus = onRoute(command, pathname) ? (query === '' ? 40 : 8) : 0
    const usageBonus = Math.min((usage[command.id] ?? 0) * (query === '' ? 6 : 2), 30)
    // Declared order is the last tie-break, so the list never reshuffles at random.
    out.push({ command, score: best + contextBonus + usageBonus - index * 0.01 })
  })

  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}

/** Group ranked results for rendering, preserving the ranked order within each. */
export function groupCommands(scored: ScoredCommand[]): Array<{ group: CommandGroup; items: Command[] }> {
  const groups: CommandGroup[] = ['create', 'navigate', 'account']
  return groups
    .map((group) => ({
      group,
      items: scored.filter((row) => row.command.group === group).map((row) => row.command),
    }))
    .filter((entry) => entry.items.length > 0)
}
