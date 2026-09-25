/**
 * Offline fixtures for the Reports screen — the executable mirror of
 * `supabase/migrations/006_rfm.sql`.
 *
 * Why a mirror rather than a canned JSON blob: the Reports cards only make
 * sense if their numbers reconcile (new + repeat + reactivated must equal this
 * year's donors; the six RFM tiles must sum to the donor base; the peak bar
 * must be the biggest month). Hand-written fixtures drift out of agreement the
 * moment anyone edits them. So the harness carries a deterministic gift ledger
 * and runs the *same* algorithms the database runs over it:
 *
 *   - `cumeDistScores`  — `ceil(cume_dist() * 5)`, quintiles that keep ties
 *                          together (`ntile` would split them arbitrarily)
 *   - `rfmPersona`      — the six personas of 02 §4.5, in precedence order
 *   - `runRfm`          — the whole segmentation, refusing under `minDonors`
 *   - `runRetention`    — gave-last-and-this ÷ gave-last, with new / repeat /
 *                          reactivated / lapsed and the prior year's rate
 *   - `givingBuckets`   — months of a year, or one bar per year for all time
 *   - `scrubMoney`      — `crm_scrub_money`, the amount redaction of 11 §2
 *
 * `tests/reports-*.test.ts` pins these against the edges (ties, fewer than five
 * donors, a reactivated donor, a missing prior year), which is how we know the
 * contract the SQL implements is the contract the screens were built against.
 *
 * Deterministic: one seeded PRNG, no `Math.random`, no network.
 */

/* ------------------------------------------------------------------- dates */

export const isoDate = (date) => date.toISOString().slice(0, 10)

export function monthsBefore(date, months) {
  const out = new Date(date.getTime())
  out.setUTCMonth(out.getUTCMonth() - months)
  return out
}

const yearOf = (iso) => Number(iso.slice(0, 4))
const round1 = (value) => Math.round(value * 10) / 10
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/* ------------------------------------------------------------- 1. quintiles */

/**
 * `ceil(cume_dist() over (order by value) * 5)` — 1…5 with 5 = best.
 *
 * cume_dist is "the fraction of rows with a value <= this one", so equal inputs
 * always score the same. That is the whole reason the migration prefers it to
 * `ntile`: three donors who each gave once, on the same day, must land in the
 * same bucket rather than being split by row order.
 */
export function cumeDistScores(values) {
  const n = values.length
  if (n === 0) return []
  const sorted = [...values].sort((a, b) => a - b)
  return values.map((value) => {
    // Number of entries <= value, via upper-bound binary search.
    let low = 0
    let high = n
    while (low < high) {
      const mid = (low + high) >> 1
      if (sorted[mid] <= value) low = mid + 1
      else high = mid
    }
    return Math.max(1, Math.min(5, Math.ceil((low / n) * 5)))
  })
}

export const RFM_DEFAULTS = {
  lookbackMonths: 36,
  minDonors: 5,
  topScore: 4,
  lowRecency: 2,
  newMonths: 12,
}

export const RFM_SEGMENTS = [
  { name: 'Champions', isAlert: false, sortOrder: 1 },
  { name: 'Loyal', isAlert: false, sortOrder: 2 },
  { name: 'New & Promising', isAlert: false, sortOrder: 3 },
  { name: 'At-Risk', isAlert: true, sortOrder: 4 },
  { name: "Can't Lose Them", isAlert: true, sortOrder: 5 },
  { name: 'Small & Steady', isAlert: false, sortOrder: 6 },
]

/**
 * The six personas, in precedence order — a donor gets exactly one.
 * Can't-Lose-Them outranks At-Risk: both have gone quiet, but one of them is
 * worth more, and that is the call the fundraiser needs made for them.
 */
export function rfmPersona({ r, f, m, firstGiftOn, today = new Date(), params = RFM_DEFAULTS }) {
  const { topScore, lowRecency, newMonths } = params
  if (r >= topScore && f >= topScore && m >= topScore) return 'Champions'
  if (m >= topScore && r <= lowRecency) return "Can't Lose Them"
  if (f >= topScore && r <= lowRecency) return 'At-Risk'
  if (firstGiftOn >= isoDate(monthsBefore(today, newMonths)) && r >= topScore) return 'New & Promising'
  if (f >= topScore) return 'Loyal'
  return 'Small & Steady'
}

/**
 * `run_rfm()` over a gift ledger. Returns the per-donor assignment and the
 * counts; under `minDonors` it refuses and reports why, exactly as the SQL
 * does — the report then shows "not enough history yet" instead of six zeros.
 */
export function runRfm(gifts, { today = new Date(), params = RFM_DEFAULTS } = {}) {
  const cutoff = isoDate(monthsBefore(today, params.lookbackMonths))
  const base = new Map()

  for (const gift of gifts) {
    if (gift.status !== 'received') continue
    if (gift.donated_on < cutoff) continue
    const found = base.get(gift.contact_id)
    if (!found) {
      base.set(gift.contact_id, {
        contact_id: gift.contact_id,
        first_gift_on: gift.donated_on,
        last_gift_on: gift.donated_on,
        gift_count: 1,
        lifetime: gift.amount_gbp,
      })
      continue
    }
    if (gift.donated_on < found.first_gift_on) found.first_gift_on = gift.donated_on
    if (gift.donated_on > found.last_gift_on) found.last_gift_on = gift.donated_on
    found.gift_count += 1
    found.lifetime += gift.amount_gbp
  }

  const donors = [...base.values()]
  if (donors.length < params.minDonors) {
    return { skipped: 'not_enough_donors', donors: donors.length, counts: {}, assignments: new Map() }
  }

  const r = cumeDistScores(donors.map((d) => Date.parse(d.last_gift_on)))
  const f = cumeDistScores(donors.map((d) => d.gift_count))
  const m = cumeDistScores(donors.map((d) => d.lifetime))

  const counts = Object.fromEntries(RFM_SEGMENTS.map((segment) => [segment.name, 0]))
  const assignments = new Map()
  donors.forEach((donor, index) => {
    const segment = rfmPersona({
      r: r[index],
      f: f[index],
      m: m[index],
      firstGiftOn: donor.first_gift_on,
      today,
      params,
    })
    counts[segment] += 1
    assignments.set(donor.contact_id, segment)
  })

  return { donors: donors.length, counts, assignments, scored: donors.map((donor, index) => ({
    ...donor,
    r_score: r[index],
    f_score: f[index],
    m_score: m[index],
    segment: assignments.get(donor.contact_id),
  })) }
}

/* ------------------------------------------------------------- 2. retention */

/**
 * Donor retention for one year.
 *
 *   rate       = gave last year AND this year ÷ gave last year
 *   repeat     = the same set as `retained` (the card names it differently)
 *   new        = first ever gift landed this year
 *   reactivated= gave this year, not last, but had given before — the third
 *                cohort people forget, and the one worth a phone call
 *   lapsed     = gave last year, nothing this year
 *
 * new + repeat + reactivated == this year's donors, always: the three are
 * disjoint and exhaustive over the set of people who gave this year.
 */
export function runRetention(gifts, year) {
  const years = new Map()
  for (const gift of gifts) {
    if (gift.status !== 'received') continue
    const set = years.get(gift.contact_id) ?? new Set()
    set.add(yearOf(gift.donated_on))
    years.set(gift.contact_id, set)
  }

  const gaveIn = (contact, y) => (years.get(contact)?.has(y) ? true : false)
  const firstYear = (contact) => Math.min(...years.get(contact))
  const contacts = [...years.keys()]

  const cur = contacts.filter((c) => gaveIn(c, year))
  const prior = contacts.filter((c) => gaveIn(c, year - 1))
  const prior2 = contacts.filter((c) => gaveIn(c, year - 2))

  const retained = cur.filter((c) => gaveIn(c, year - 1)).length
  const retainedPrior = prior.filter((c) => gaveIn(c, year - 2)).length
  const newDonors = cur.filter((c) => firstYear(c) === year).length
  const reactivated = cur.filter((c) => firstYear(c) < year && !gaveIn(c, year - 1)).length
  const lapsed = prior.filter((c) => !gaveIn(c, year)).length

  const rateExact = prior.length > 0 ? (retained * 100) / prior.length : null
  const priorRateExact = prior2.length > 0 ? (retainedPrior * 100) / prior2.length : null

  return {
    year,
    gave_prior: prior.length,
    retained,
    new_donors: newDonors,
    repeat_donors: retained,
    reactivated,
    lapsed,
    current_donors: cur.length,
    rate: rateExact === null ? null : round1(rateExact),
    prior_rate: priorRateExact === null ? null : round1(priorRateExact),
    delta_pts:
      rateExact === null || priorRateExact === null ? null : round1(rateExact - priorRateExact),
  }
}

/* ---------------------------------------------------------- 3. giving buckets */

/**
 * Months of one year (stopping at the current month — no eight empty bars for
 * a future nobody has given in yet), or one bar per year for all time.
 */
export function givingBuckets(gifts, year, today = new Date()) {
  const received = gifts.filter((gift) => gift.status === 'received')
  const thisYear = today.getUTCFullYear()

  const keys = []
  if (year === null) {
    const allYears = received.map((gift) => yearOf(gift.donated_on))
    const from = allYears.length > 0 ? Math.min(...allYears) : thisYear
    const to = allYears.length > 0 ? Math.max(...allYears) : thisYear
    for (let y = from; y <= to; y += 1) {
      keys.push({ bucket_key: String(y), label: String(y), is_current: y === thisYear })
    }
  } else {
    const lastMonth = year === thisYear ? today.getUTCMonth() + 1 : 12
    for (let month = 1; month <= lastMonth; month += 1) {
      keys.push({
        bucket_key: `${year}-${String(month).padStart(2, '0')}`,
        label: MONTHS[month - 1],
        is_current: year === thisYear && month === today.getUTCMonth() + 1,
      })
    }
  }

  return keys.map((bucket) => {
    const inBucket = received.filter((gift) => gift.donated_on.startsWith(bucket.bucket_key))
    return {
      ...bucket,
      total: Number(inBucket.reduce((sum, gift) => sum + gift.amount_gbp, 0).toFixed(2)),
      gift_count: inBucket.length,
      donor_count: new Set(inBucket.map((gift) => gift.contact_id)).size,
    }
  })
}

/* --------------------------------------------------------------- 4. redaction */

export const MONEY_KEYS = [
  'total', 'raised', 'goal', 'pledged_outstanding', 'gift_total', 'amount', 'lifetime',
  'claimed', 'recoverable', 'prior_total', 'largest', 'paid', 'outstanding', 'ytd',
  'peak_total', 'average', 'balance', 'ask_amount', 'total_amount',
]

/**
 * `crm_scrub_money` — null every money-carrying key at any depth, leaving the
 * counts intact (11 §2). A restricted viewer must still learn *how many* donors
 * were retained; they must not learn what those donors gave.
 */
export function scrubMoney(doc, keys = MONEY_KEYS) {
  if (doc === null || doc === undefined) return doc
  if (Array.isArray(doc)) return doc.map((entry) => scrubMoney(entry, keys))
  if (typeof doc !== 'object') return doc
  const out = {}
  for (const [key, value] of Object.entries(doc)) {
    out[key] =
      keys.includes(key) && (typeof value === 'number' || typeof value === 'string')
        ? null
        : scrubMoney(value, keys)
  }
  return out
}

/* ------------------------------------------------------------- 5. the ledger */

/** mulberry32 — small, seeded, and identical on every run. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FIRST_NAMES = [
  'Dovid', 'Rivky', 'Shloimy', 'Chana', 'Yossi', 'Miriam', 'Ari', 'Leah', 'Menachem', 'Sara',
  'Zev', 'Devorah', 'Naftali', 'Bracha', 'Yitzchok', 'Esti', 'Shimon', 'Tzipora', 'Baruch', 'Rochel',
]
const LAST_NAMES = [
  'Cohen', 'Klein', 'Weiss', 'Adler', 'Reich', 'Katz', 'Goldstein', 'Feld', 'Braun', 'Stern',
  'Mandel', 'Roth', 'Deutsch', 'Landau', 'Halpern', 'Frankel', 'Guttman', 'Neuman', 'Salzman', 'Zilber',
]
const CITIES = ['London', 'Manchester', 'Gateshead', 'Salford', 'Golders Green', 'Stamford Hill']

export const FUNDS = [
  { id: 'fund-general', name: 'General' },
  { id: 'fund-scholarships', name: 'Scholarships' },
  { id: 'fund-building', name: 'Building' },
  { id: 'fund-kollel', name: 'Kollel' },
]

export const CAMPAIGNS = [
  { id: 'camp-building', name: 'Building campaign', goal: 900000, description: 'The new beis medrash', starts_on: '2024-09-01', ends_on: '2027-08-31', is_active: true },
  { id: 'camp-scholarships', name: 'Scholarships fund', goal: 120000, description: 'Bursaries for talmidim', starts_on: '2025-09-01', ends_on: '2026-08-31', is_active: true },
]

export const TEAM = [
  { member_id: 'team-avi', member_name: 'Avi Braun' },
  { member_id: 'team-rivka', member_name: 'Rivka Klein' },
  { member_id: 'team-shaindy', member_name: 'Shaindy Katz' },
]

/**
 * Appeals carry a year and a channel so "Dinner 2026 vs Dinner 2025" is one
 * filter (05 §4) — and so the YoY line on the Campaigns card has something real
 * to compare.
 */
export const APPEALS = [
  { id: 'appeal-dinner-2026', name: 'Dinner 2026', year: 2026, channel: 'dinner', campaign_id: 'camp-building' },
  { id: 'appeal-dinner-2025', name: 'Dinner 2025', year: 2025, channel: 'dinner', campaign_id: 'camp-building' },
  { id: 'appeal-purim-2026', name: 'Purim Appeal 2026', year: 2026, channel: 'letter', campaign_id: 'camp-scholarships' },
  { id: 'appeal-purim-2025', name: 'Purim Appeal 2025', year: 2025, channel: 'letter', campaign_id: 'camp-scholarships' },
]

/**
 * Purim (March) is the peak of the yeshiva year and the annual dinner sits in
 * June — before the current month, so the *current* year's dinner appeal has
 * gifts against it and the YoY line has something to compare.
 */
const MONTH_WEIGHT = [4, 5, 22, 9, 6, 15, 4, 4, 5, 7, 9, 10]
/** Which appeal a gift belongs to, by month. */
const APPEAL_MONTH = { 3: 'Purim Appeal', 6: 'Dinner' }

/**
 * A deterministic donor base: 240 contacts, four giving profiles, gifts from
 * 2022 to today. The profiles exist so the RFM quintiles have something to
 * separate — a ledger of identical donors segments into one tile and proves
 * nothing.
 */
export function buildLedger({ today = new Date(), seed = 20260828, contactCount = 240 } = {}) {
  const random = rng(seed)
  const pick = (list) => list[Math.floor(random() * list.length)]
  const thisYear = today.getUTCFullYear()
  const todayIso = isoDate(today)

  const contacts = []
  const gifts = []
  let giftId = 0

  for (let index = 0; index < contactCount; index += 1) {
    const id = `person-${String(index + 1).padStart(3, '0')}`
    const first = FIRST_NAMES[index % FIRST_NAMES.length]
    const last = LAST_NAMES[(index * 7 + 3) % LAST_NAMES.length]
    contacts.push({
      id,
      name: `${first} ${last}`,
      secondary: `${pick(CITIES)} · ${pick(['donor', 'keep_in_touch', 'prospect'])}`,
    })

    // Profile decides how often and how much — which is exactly what R, F and M
    // measure, so the quintiles have something real to separate. `returning`
    // exists to put people in the reactivated cohort: gave once, went quiet for
    // a year, came back.
    const roll = random()
    const profile =
      roll < 0.08 ? 'major'
      : roll < 0.28 ? 'regular'
      : roll < 0.42 ? 'lapsing'
      : roll < 0.5 ? 'returning'
      : roll < 0.65 ? 'new'
      : 'occasional'

    const plan = {
      major: { years: [2023, 2024, 2025, thisYear], perYear: 3, size: [1500, 9000] },
      regular: { years: [2024, 2025, thisYear], perYear: 2, size: [180, 900] },
      lapsing: { years: [2023, 2024], perYear: 2, size: [400, 2600] },
      returning: { years: [2023, thisYear], perYear: 1, size: [120, 1400] },
      new: { years: [thisYear], perYear: 1, size: [60, 700] },
      occasional: { years: [2025, thisYear], perYear: 1, size: [40, 320] },
    }[profile]

    for (const year of plan.years) {
      if (year > thisYear) continue
      const count = 1 + Math.floor(random() * plan.perYear)
      for (let n = 0; n < count; n += 1) {
        // Weighted month, so the year has the shape a yeshiva year actually has.
        const target = random() * MONTH_WEIGHT.reduce((a, b) => a + b, 0)
        let running = 0
        let month = 1
        for (let m = 0; m < 12; m += 1) {
          running += MONTH_WEIGHT[m]
          if (target <= running) {
            month = m + 1
            break
          }
        }
        const day = 1 + Math.floor(random() * 27)
        const donatedOn = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
        if (donatedOn > todayIso) continue

        const amount = Math.round(plan.size[0] + random() * (plan.size[1] - plan.size[0]))
        const appealStem = APPEAL_MONTH[month]
        const appeal = appealStem
          ? (APPEALS.find((entry) => entry.name === `${appealStem} ${year}`) ?? null)
          : null
        const campaign = appeal
          ? CAMPAIGNS.find((c) => c.id === appeal.campaign_id)
          : random() < 0.55
            ? CAMPAIGNS[0]
            : null

        giftId += 1
        gifts.push({
          id: `gift-${String(giftId).padStart(4, '0')}`,
          contact_id: id,
          donated_on: donatedOn,
          amount_gbp: amount,
          status: 'received',
          fund: pick(FUNDS),
          campaign_id: campaign?.id ?? null,
          appeal_id: appeal?.id ?? null,
          created_by: TEAM[index % TEAM.length].member_id,
        })
      }
    }
  }

  gifts.sort((a, b) => (a.donated_on < b.donated_on ? -1 : a.donated_on > b.donated_on ? 1 : 0))
  return { contacts, gifts }
}

/* ------------------------------------------------------- 6. payload builders */

const BENCHMARKS = { retention_overall: 43, retention_7plus: 87, source: 'FEP', year: 2026 }

const campaignRows = (gifts, pledges) =>
  CAMPAIGNS.map((campaign) => {
    const own = gifts.filter((gift) => gift.campaign_id === campaign.id && gift.status === 'received')
    const raised = own.reduce((sum, gift) => sum + gift.amount_gbp, 0)
    const outstanding = pledges
      .filter((pledge) => pledge.campaign_id === campaign.id)
      .reduce((sum, pledge) => sum + pledge.outstanding, 0)
    return {
      id: campaign.id,
      name: campaign.name,
      goal: campaign.goal,
      raised,
      pledged_outstanding: outstanding,
      gift_count: own.length,
      donor_count: new Set(own.map((gift) => gift.contact_id)).size,
      pct: campaign.goal > 0 ? round1((raised * 100) / campaign.goal) : null,
      starts_on: campaign.starts_on,
      ends_on: campaign.ends_on,
    }
  }).sort((a, b) => b.raised - a.raised)

const appealRows = (gifts, year) => {
  const totals = APPEALS.map((appeal) => {
    const own = gifts.filter((gift) => gift.appeal_id === appeal.id && gift.status === 'received')
    return {
      ...appeal,
      stem: appeal.name.replace(/\s*\d{4}\s*$/, ''),
      total: own.reduce((sum, gift) => sum + gift.amount_gbp, 0),
      gift_count: own.length,
    }
  })
  return totals
    .filter((appeal) => year === null || appeal.year === year)
    .map((appeal) => {
      const prior = totals.find((other) => other.stem === appeal.stem && other.year === appeal.year - 1)
      return {
        id: appeal.id,
        name: appeal.name,
        year: appeal.year,
        channel: appeal.channel,
        total: appeal.total,
        gift_count: appeal.gift_count,
        prior_id: prior?.id ?? null,
        prior_name: prior?.name ?? null,
        prior_year: prior?.year ?? null,
        prior_total: prior?.total ?? null,
        delta_pct:
          prior && prior.total > 0 ? round1(((appeal.total - prior.total) * 100) / prior.total) : null,
      }
    })
    .sort((a, b) => b.total - a.total)
}

/** Two open pledges, so the campaign page has an outstanding list to show. */
export const PLEDGES = [
  {
    id: 'pledge-1',
    contact_id: 'person-004',
    campaign_id: 'camp-building',
    total_amount: 50000,
    paid: 20000,
    outstanding: 30000,
    status: 'open',
    next_due_on: '2026-10-01',
    overdue_count: 0,
  },
  {
    id: 'pledge-2',
    contact_id: 'person-011',
    campaign_id: 'camp-building',
    total_amount: 18000,
    paid: 6000,
    outstanding: 12000,
    status: 'open',
    next_due_on: '2026-07-15',
    overdue_count: 1,
  },
]

/**
 * `report_overview(p_year)`. `year === null` is all time.
 * `amountsHidden` runs the payload through `scrubMoney`, exactly as the RPC
 * does for a member without `can_see_amounts`.
 */
export function buildOverview({ year, today = new Date(), amountsHidden = false, ledger } = {}) {
  const world = ledger ?? buildLedger({ today })
  const { contacts, gifts } = world
  const thisYear = today.getUTCFullYear()
  const scopedYear = year === null ? thisYear : year

  const rfm = runRfm(gifts, { today })
  const buckets = givingBuckets(gifts, year, today)
  const peak = buckets.reduce((best, bucket) => (bucket.total > (best?.total ?? 0) ? bucket : best), null)
  const inScope = gifts.filter(
    (gift) => gift.status === 'received' && (year === null || yearOf(gift.donated_on) === year),
  )

  const activityFrom =
    year === null ? null : year === thisYear ? `${thisYear}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-01` : `${year}-01-01`
  const activityTo = year === null ? null : year === thisYear ? isoDate(today) : `${year}-12-31`
  const activityLabel = year === null ? 'All time' : year === thisYear ? 'This month' : String(year)

  const inWindow = gifts.filter(
    (gift) =>
      gift.status === 'received' &&
      (activityFrom === null || gift.donated_on >= activityFrom) &&
      (activityTo === null || gift.donated_on <= activityTo),
  )

  const payload = {
    year: scopedYear,
    scope: year === null ? 'all_time' : String(year),
    granularity: year === null ? 'year' : 'month',
    amounts_hidden: amountsHidden,
    generated_at: `${isoDate(today)}T06:00:00Z`,
    retention: { ...runRetention(gifts, scopedYear), benchmark_overall: BENCHMARKS.retention_overall, benchmark_7plus: BENCHMARKS.retention_7plus, benchmark_source: BENCHMARKS.source, benchmark_year: BENCHMARKS.year },
    giving: {
      buckets,
      total: inScope.reduce((sum, gift) => sum + gift.amount_gbp, 0),
      gift_count: inScope.length,
      peak_key: peak && peak.total > 0 ? peak.bucket_key : null,
    },
    rfm: {
      segments: RFM_SEGMENTS.map((segment) => ({
        segment: segment.name,
        tag_id: `tag-${segment.sortOrder}`,
        headcount: rfm.counts[segment.name] ?? 0,
        // A previous run that moved a few donors, so the tiles show movement.
        previous: Math.max(0, (rfm.counts[segment.name] ?? 0) - [2, 0, 9, 4, 0, -3][segment.sortOrder - 1]),
        is_alert: segment.isAlert,
        sort_order: segment.sortOrder,
      })),
      computed_at: `${isoDate(today)}T05:30:00Z`,
      previous_computed_at: `${isoDate(monthsBefore(today, 1))}T05:30:00Z`,
      donors: rfm.donors,
    },
    campaigns: campaignRows(gifts, PLEDGES),
    appeals: appealRows(gifts, year),
    activity: {
      label: activityLabel,
      from: activityFrom,
      to: activityTo,
      members: TEAM.map((member, index) => {
        const own = inWindow.filter((gift) => gift.created_by === member.member_id)
        return {
          ...member,
          interactions: [12, 7, 0][index],
          tasks_completed: [4, 3, 0][index],
          gifts: own.length,
          gift_total: own.reduce((sum, gift) => sum + gift.amount_gbp, 0),
        }
      }),
    },
    gift_aid: (() => {
      const eligible = inScope.filter((_, index) => index % 3 === 0)
      const pending = inScope.filter((_, index) => index % 5 === 0)
      const donorCount = new Set(gifts.map((gift) => gift.contact_id)).size
      const declared = Math.round(donorCount * 0.62)
      return {
        claimed: Math.round(inScope.reduce((sum, gift) => sum + gift.amount_gbp, 0) * 0.11),
        recoverable: Math.round(eligible.reduce((sum, gift) => sum + gift.amount_gbp, 0) * 0.25),
        coverage_pct: donorCount > 0 ? round1((declared * 100) / donorCount) : null,
        donors_with_declaration: declared,
        donor_count: donorCount,
        eligible_gift_count: eligible.length,
        pending_gift_count: pending.length,
      }
    })(),
    _contacts: contacts,
  }

  delete payload._contacts
  return amountsHidden ? scrubMoney(payload) : payload
}

/** `report_campaign_detail(p_campaign_id)`. */
export function buildCampaignDetail(campaignId, { today = new Date(), amountsHidden = false, ledger } = {}) {
  const world = ledger ?? buildLedger({ today })
  const { contacts, gifts } = world
  const campaign = CAMPAIGNS.find((entry) => entry.id === campaignId) ?? null
  if (!campaign) return { campaign: null, amounts_hidden: amountsHidden, progress: null, appeals: [], top_gifts: [], gifts: [], pledges: [] }

  const nameOf = (contactId) => contacts.find((c) => c.id === contactId)?.name ?? 'Unnamed contact'
  const own = gifts.filter((gift) => gift.campaign_id === campaignId && gift.status === 'received')
  const asRow = (gift) => ({
    id: gift.id,
    contact_id: gift.contact_id,
    contact_name: nameOf(gift.contact_id),
    donated_on: gift.donated_on,
    amount: gift.amount_gbp,
    appeal_name: APPEALS.find((appeal) => appeal.id === gift.appeal_id)?.name ?? null,
    fund_name: gift.fund.name,
    thank_you_status: 'done',
  })

  const payload = {
    campaign: { ...campaign, goal: campaign.goal },
    amounts_hidden: amountsHidden,
    progress: campaignRows(gifts, PLEDGES).find((row) => row.id === campaignId) ?? null,
    appeals: APPEALS.filter((appeal) => appeal.campaign_id === campaignId).map((appeal) => {
      const rows = own.filter((gift) => gift.appeal_id === appeal.id)
      return {
        id: appeal.id,
        name: appeal.name,
        channel: appeal.channel,
        year: appeal.year,
        total: rows.reduce((sum, gift) => sum + gift.amount_gbp, 0),
        gift_count: rows.length,
        donor_count: new Set(rows.map((gift) => gift.contact_id)).size,
      }
    }).sort((a, b) => b.total - a.total),
    top_gifts: [...own].sort((a, b) => b.amount_gbp - a.amount_gbp).slice(0, 10).map(asRow),
    gifts: [...own].sort((a, b) => (a.donated_on < b.donated_on ? 1 : -1)).slice(0, 100).map(asRow),
    pledges: PLEDGES.filter((pledge) => pledge.campaign_id === campaignId).map((pledge) => ({
      ...pledge,
      contact_name: nameOf(pledge.contact_id),
    })),
  }

  return amountsHidden ? scrubMoney(payload) : payload
}

/** `report_drill(p_key, p_year, p_arg)` — the people behind one number. */
export function buildDrill({ key, year, arg, today = new Date(), amountsHidden = false, ledger } = {}) {
  const world = ledger ?? buildLedger({ today })
  const { contacts, gifts } = world
  const thisYear = today.getUTCFullYear()
  const scopedYear = year === null || year === undefined ? thisYear : year
  const received = gifts.filter((gift) => gift.status === 'received')

  const yearsOf = (contactId) =>
    new Set(received.filter((gift) => gift.contact_id === contactId).map((gift) => yearOf(gift.donated_on)))
  const rfm = runRfm(gifts, { today })

  const matches = (contact) => {
    const years = yearsOf(contact.id)
    const first = years.size > 0 ? Math.min(...years) : null
    switch (key) {
      case 'retention_new':
        return years.has(scopedYear) && first === scopedYear
      case 'retention_repeat':
        return years.has(scopedYear) && years.has(scopedYear - 1)
      case 'retention_reactivated':
        return years.has(scopedYear) && !years.has(scopedYear - 1) && first !== null && first < scopedYear
      case 'retention_lapsed':
        return years.has(scopedYear - 1) && !years.has(scopedYear)
      case 'retention_prior':
        return years.has(scopedYear - 1)
      case 'donors':
        return years.has(scopedYear)
      case 'rfm':
        return rfm.assignments.get(contact.id) === arg
      case 'bucket':
        return received.some((gift) => gift.contact_id === contact.id && gift.donated_on.startsWith(arg))
      case 'campaign':
        return received.some((gift) => gift.contact_id === contact.id && gift.campaign_id === arg)
      case 'appeal':
        return received.some((gift) => gift.contact_id === contact.id && gift.appeal_id === arg)
      case 'activity':
        return received.some((gift) => gift.contact_id === contact.id && gift.created_by === arg)
      case 'gift_aid_pending':
      case 'gift_aid_eligible':
        return years.size > 0 && Number(contact.id.slice(-3)) % 4 === 0
      default:
        return false
    }
  }

  const rows = contacts.filter(matches).map((contact) => {
    const own = received.filter((gift) => gift.contact_id === contact.id)
    return {
      contact_id: contact.id,
      contact_name: contact.name,
      secondary: contact.secondary,
      amount: amountsHidden ? null : own.reduce((sum, gift) => sum + gift.amount_gbp, 0),
      gift_count: own.length,
      last_gift_on: own.length > 0 ? own[own.length - 1].donated_on : null,
    }
  })

  rows.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || a.contact_name.localeCompare(b.contact_name))
  return rows.slice(0, 500)
}
