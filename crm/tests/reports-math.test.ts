/**
 * The Reports contract, tested at the edges.
 *
 * `e2e/reports-fixtures.mjs` is the executable mirror of
 * `supabase/migrations/006_rfm.sql` — the same quintile, persona, retention,
 * bucket and redaction rules, in JavaScript, so the offline harness shows what
 * the database would show. These tests pin that contract:
 *
 *   - retention, including the reactivated cohort everyone forgets
 *   - quintile ties (cume_dist, not ntile) and the fewer-than-five-donors floor
 *   - year-on-year deltas, including "there is no prior year"
 *   - amount redaction leaving counts intact (11 §2)
 */

import { describe, expect, it } from 'vitest'
import {
  MONEY_KEYS,
  RFM_DEFAULTS,
  buildLedger,
  buildOverview,
  cumeDistScores,
  givingBuckets,
  rfmPersona,
  runRetention,
  runRfm,
  scrubMoney,
} from '../e2e/reports-fixtures.mjs'

const TODAY = new Date('2026-08-28T00:00:00Z')

const gift = (contact: string, donatedOn: string, amount = 100) => ({
  id: `${contact}-${donatedOn}`,
  contact_id: contact,
  donated_on: donatedOn,
  amount_gbp: amount,
  status: 'received',
  fund: { id: 'f', name: 'General' },
  campaign_id: null,
  appeal_id: null,
  created_by: 'team-avi',
})

/* --------------------------------------------------------------- retention */

describe('retention', () => {
  // Six donors, one of each shape, so every cohort has exactly one member and
  // a miscount shows up as an off-by-one rather than hiding in an aggregate.
  const ledger = [
    // repeat: gave 2025 and 2026
    gift('repeat', '2025-03-01'),
    gift('repeat', '2026-03-01'),
    // new: first ever gift is 2026
    gift('new', '2026-05-01'),
    // reactivated: gave 2024, skipped 2025, back in 2026
    gift('reactivated', '2024-02-01'),
    gift('reactivated', '2026-02-01'),
    // lapsed: gave 2025, nothing in 2026
    gift('lapsed', '2025-06-01'),
    // long lapsed: 2024 only — neither retained nor lapsed *this* year
    gift('long-lapsed', '2024-06-01'),
    // steady: 2024, 2025, 2026 — repeat, and part of the prior year's retention
    gift('steady', '2024-09-01'),
    gift('steady', '2025-09-01'),
    gift('steady', '2026-09-01'),
  ]

  const result = runRetention(ledger, 2026)

  it('divides gave-last-and-this by gave-last', () => {
    // 2025 donors: repeat, lapsed, steady = 3. Of those, repeat + steady gave
    // again in 2026 → 2/3 = 66.7%.
    expect(result.gave_prior).toBe(3)
    expect(result.retained).toBe(2)
    expect(result.rate).toBe(66.7)
  })

  it('counts the reactivated cohort separately from new donors', () => {
    expect(result.new_donors).toBe(1)
    expect(result.reactivated).toBe(1)
    expect(result.repeat_donors).toBe(2)
  })

  it('partitions this year’s donors exactly once each', () => {
    expect(result.new_donors + result.repeat_donors + result.reactivated).toBe(
      result.current_donors,
    )
    expect(result.current_donors).toBe(4)
  })

  it('counts last year’s donors who did not come back as lapsed', () => {
    // `lapsed` gave in 2025 and not 2026. `long-lapsed` gave in 2024 only, so it
    // is not part of *this* year's retention question at all.
    expect(result.lapsed).toBe(1)
  })

  it('reports the prior year’s rate and the year-on-year swing', () => {
    // 2024 donors: reactivated, long-lapsed, steady = 3. Of those only `steady`
    // gave again in 2025 → 33.3%. 66.7 − 33.3 = 33.3 points.
    expect(result.prior_rate).toBe(33.3)
    expect(result.delta_pts).toBe(33.3)
  })

  it('returns null rather than zero when there is no prior year to compare', () => {
    const firstYear = runRetention([gift('only', '2026-01-01')], 2026)
    expect(firstYear.gave_prior).toBe(0)
    expect(firstYear.rate).toBeNull()
    expect(firstYear.prior_rate).toBeNull()
    expect(firstYear.delta_pts).toBeNull()
  })
})

/* ---------------------------------------------------------------- quintiles */

describe('RFM quintiles', () => {
  it('gives 1…5 with 5 as the best score', () => {
    const scores = cumeDistScores([10, 20, 30, 40, 50])
    expect(scores).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps ties in the same bucket (cume_dist, not ntile)', () => {
    // Three donors who each gave once: ntile would split them across buckets by
    // row order; cume_dist scores all three identically.
    const scores = cumeDistScores([1, 1, 1, 5, 9])
    expect(scores[0]).toBe(scores[1])
    expect(scores[1]).toBe(scores[2])
    expect(scores[3]).toBeGreaterThan(scores[0])
    expect(scores[4]).toBe(5)
  })

  it('puts an entirely tied population in the top bucket, not spread across five', () => {
    expect(cumeDistScores([7, 7, 7, 7])).toEqual([5, 5, 5, 5])
  })

  it('never scores outside 1…5, whatever the population size', () => {
    for (const size of [1, 2, 3, 7, 11, 100]) {
      const values = Array.from({ length: size }, (_, index) => index)
      const scores = cumeDistScores(values)
      expect(scores).toHaveLength(size)
      expect(Math.min(...scores)).toBeGreaterThanOrEqual(1)
      expect(Math.max(...scores)).toBeLessThanOrEqual(5)
    }
  })

  it('handles the empty population', () => {
    expect(cumeDistScores([])).toEqual([])
  })
})

describe('RFM personas', () => {
  const base = { firstGiftOn: '2019-01-01', today: TODAY, params: RFM_DEFAULTS }

  it('names the top-right corner Champions', () => {
    expect(rfmPersona({ ...base, r: 5, f: 5, m: 5 })).toBe('Champions')
    expect(rfmPersona({ ...base, r: 4, f: 4, m: 4 })).toBe('Champions')
  })

  it('prefers Can’t Lose Them over At-Risk when the donor is valuable', () => {
    // Both patterns hold (high F *and* high M, low R); the more valuable call
    // wins, because that is the one worth a fundraiser's morning.
    expect(rfmPersona({ ...base, r: 1, f: 5, m: 5 })).toBe("Can't Lose Them")
    expect(rfmPersona({ ...base, r: 1, f: 5, m: 2 })).toBe('At-Risk')
  })

  it('only calls a donor New & Promising if the first gift is genuinely recent', () => {
    expect(rfmPersona({ ...base, r: 5, f: 1, m: 1, firstGiftOn: '2026-05-01' })).toBe(
      'New & Promising',
    )
    expect(rfmPersona({ ...base, r: 5, f: 1, m: 1, firstGiftOn: '2019-01-01' })).toBe(
      'Small & Steady',
    )
  })

  it('falls back to Loyal on frequency alone, then to the community base', () => {
    expect(rfmPersona({ ...base, r: 3, f: 5, m: 1 })).toBe('Loyal')
    expect(rfmPersona({ ...base, r: 3, f: 2, m: 2 })).toBe('Small & Steady')
  })
})

describe('run_rfm()', () => {
  it('refuses to segment fewer than five donors and leaves the tags alone', () => {
    const tiny = [
      gift('a', '2026-01-01'),
      gift('b', '2026-01-02'),
      gift('c', '2026-01-03'),
      gift('d', '2026-01-04'),
    ]
    const result = runRfm(tiny, { today: TODAY })
    expect(result.skipped).toBe('not_enough_donors')
    expect(result.donors).toBe(4)
    expect(result.assignments.size).toBe(0)
  })

  it('segments at exactly the floor', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((id, index) =>
      gift(id, `2026-0${index + 1}-01`, 100 * (index + 1)),
    )
    const result = runRfm(five, { today: TODAY })
    expect(result.skipped).toBeUndefined()
    expect(result.donors).toBe(5)
    expect(result.assignments.size).toBe(5)
  })

  it('gives every donor exactly one persona, and the counts add up', () => {
    const ledger = buildLedger({ today: TODAY })
    const result = runRfm(ledger.gifts, { today: TODAY })
    const total = Object.values(result.counts).reduce((sum, n) => sum + n, 0)
    expect(total).toBe(result.donors)
    expect(result.assignments.size).toBe(result.donors)
  })

  it('ignores gifts older than the lookback window', () => {
    const ledger = [
      gift('ancient', '2015-01-01'),
      ...['a', 'b', 'c', 'd', 'e'].map((id, index) => gift(id, `2026-0${index + 1}-01`)),
    ]
    const result = runRfm(ledger, { today: TODAY })
    expect(result.donors).toBe(5)
    expect(result.assignments.has('ancient')).toBe(false)
  })

  it('is idempotent — the same ledger produces the same assignment', () => {
    const ledger = buildLedger({ today: TODAY })
    const first = runRfm(ledger.gifts, { today: TODAY })
    const second = runRfm(ledger.gifts, { today: TODAY })
    expect(second.counts).toEqual(first.counts)
    expect([...second.assignments.entries()]).toEqual([...first.assignments.entries()])
  })
})

/* ------------------------------------------------------------------ buckets */

describe('giving buckets', () => {
  const ledger = [gift('a', '2025-02-10', 500), gift('a', '2026-03-04', 900), gift('b', '2026-03-20', 100)]

  it('stops the current year at the current month rather than drawing empty bars', () => {
    const buckets = givingBuckets(ledger, 2026, TODAY)
    expect(buckets).toHaveLength(8)
    expect(buckets.at(-1)?.bucket_key).toBe('2026-08')
    expect(buckets.at(-1)?.is_current).toBe(true)
  })

  it('draws all twelve months of a completed year', () => {
    expect(givingBuckets(ledger, 2025, TODAY)).toHaveLength(12)
  })

  it('groups by year for all time', () => {
    const buckets = givingBuckets(ledger, null, TODAY)
    expect(buckets.map((bucket) => bucket.bucket_key)).toEqual(['2025', '2026'])
    expect(buckets[1].total).toBe(1000)
    expect(buckets[1].donor_count).toBe(2)
  })
})

/* ---------------------------------------------------------------- redaction */

describe('amount redaction (11 §2)', () => {
  it('nulls money at any depth and leaves counts intact', () => {
    const scrubbed = scrubMoney({
      total: 1234,
      gift_count: 7,
      nested: { raised: 99, goal: 100, donor_count: 3, deeper: [{ amount: 5, id: 'x' }] },
    })
    expect(scrubbed).toEqual({
      total: null,
      gift_count: 7,
      nested: { raised: null, goal: null, donor_count: 3, deeper: [{ amount: null, id: 'x' }] },
    })
  })

  it('leaves ratios alone — a percentage is not an amount', () => {
    const scrubbed = scrubMoney({ pct: 57, coverage_pct: 62.2, rate: 61, raised: 10 })
    expect(scrubbed.pct).toBe(57)
    expect(scrubbed.coverage_pct).toBe(62.2)
    expect(scrubbed.rate).toBe(61)
    expect(scrubbed.raised).toBeNull()
  })

  it('covers every money key the report payload can carry', () => {
    const overview = buildOverview({ year: 2026, today: TODAY })
    const hidden = buildOverview({ year: 2026, today: TODAY, amountsHidden: true })

    expect(overview.amounts_hidden).toBe(false)
    expect(hidden.amounts_hidden).toBe(true)
    expect(overview.giving.total).toBeGreaterThan(0)

    // Money gone…
    expect(hidden.giving.total).toBeNull()
    expect(hidden.giving.buckets[0].total).toBeNull()
    expect(hidden.campaigns[0].raised).toBeNull()
    expect(hidden.campaigns[0].goal).toBeNull()
    expect(hidden.gift_aid.claimed).toBeNull()
    expect(hidden.gift_aid.recoverable).toBeNull()
    expect(hidden.activity.members[0].gift_total).toBeNull()

    // …counts and ratios kept, so the cards still say something true.
    expect(hidden.giving.gift_count).toBe(overview.giving.gift_count)
    expect(hidden.giving.buckets[0].gift_count).toBe(overview.giving.buckets[0].gift_count)
    expect(hidden.retention.rate).toBe(overview.retention.rate)
    expect(hidden.retention.lapsed).toBe(overview.retention.lapsed)
    expect(hidden.rfm.segments[0].headcount).toBe(overview.rfm.segments[0].headcount)
    expect(hidden.campaigns[0].pct).toBe(overview.campaigns[0].pct)
    expect(hidden.gift_aid.coverage_pct).toBe(overview.gift_aid.coverage_pct)
  })

  it('lists every money-bearing key the cards read', () => {
    for (const key of ['total', 'raised', 'goal', 'amount', 'claimed', 'recoverable', 'gift_total']) {
      expect(MONEY_KEYS).toContain(key)
    }
    expect(MONEY_KEYS).not.toContain('gift_count')
    expect(MONEY_KEYS).not.toContain('pct')
  })
})

/* -------------------------------------------------- the assembled payload */

describe('report_overview payload', () => {
  const overview = buildOverview({ year: 2026, today: TODAY })

  it('reconciles the retention cohorts against the donor count', () => {
    const { new_donors, repeat_donors, reactivated, current_donors } = overview.retention
    expect(new_donors + repeat_donors + reactivated).toBe(current_donors)
  })

  it('marks exactly one bucket as the current period', () => {
    expect(overview.giving.buckets.filter((bucket) => bucket.is_current)).toHaveLength(1)
  })

  it('points peak_key at the biggest bucket', () => {
    const biggest = [...overview.giving.buckets].sort((a, b) => (b.total ?? 0) - (a.total ?? 0))[0]
    expect(overview.giving.peak_key).toBe(biggest.bucket_key)
  })

  it('carries the six personas in tile order, alerts flagged', () => {
    expect(overview.rfm.segments.map((segment) => segment.segment)).toEqual([
      'Champions',
      'Loyal',
      'New & Promising',
      'At-Risk',
      "Can't Lose Them",
      'Small & Steady',
    ])
    const alerts = overview.rfm.segments.filter((segment) => segment.is_alert)
    expect(alerts.map((segment) => segment.segment)).toEqual(['At-Risk', "Can't Lose Them"])
  })

  it('pairs each appeal with its prior-year twin for the YoY line', () => {
    const dinner = overview.appeals.find((appeal) => appeal.name === 'Dinner 2026')
    expect(dinner?.prior_name).toBe('Dinner 2025')
    expect(dinner?.delta_pct).toBeTypeOf('number')
  })

  it('carries the FEP benchmarks beside our own number', () => {
    expect(overview.retention.benchmark_overall).toBe(43)
    expect(overview.retention.benchmark_7plus).toBe(87)
    expect(overview.retention.benchmark_source).toBe('FEP')
  })

  it('switches to yearly granularity for all time', () => {
    const allTime = buildOverview({ year: null, today: TODAY })
    expect(allTime.granularity).toBe('year')
    expect(allTime.giving.buckets.every((bucket) => /^\d{4}$/.test(bucket.bucket_key))).toBe(true)
  })
})
