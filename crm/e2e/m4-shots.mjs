#!/usr/bin/env node
/**
 * M4 screenshots — the Giving screen (05 §4), gift entry with every inline
 * assist (05 §1) and the pledge sheet's schedule builder (05 §2).
 *
 * Against the offline fixtures (no database needed):
 *
 *   node e2e/fixture-server.mjs --port 5434
 *   VITE_SUPABASE_URL=http://127.0.0.1:5434 VITE_SUPABASE_ANON_KEY=fixture npm run dev
 *   E2E_SHOT_SUFFIX=fixtures node e2e/m4-shots.mjs
 *
 * Against the live project (sandboxed Chromium cannot open TLS to
 * *.supabase.co, hence the relay — see e2e/supabase-relay.mjs):
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs
 *   VITE_SUPABASE_URL=http://127.0.0.1:5433 npm run dev
 *   E2E_SHOT_SUFFIX=live node e2e/m4-shots.mjs
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5180'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'YeshivaCrm-demo1'
const SUFFIX = process.env.E2E_SHOT_SUFFIX ? `-${process.env.E2E_SHOT_SUFFIX}` : ''

const log = (...args) => console.log('[m4]', ...args)
const shot = (name) => join(SHOTS, `${name}${SUFFIX}.png`)

async function signInIfNeeded(page) {
  const emailField = page.getByLabel('Email')
  const todayHeading = page.getByRole('heading', { name: 'Today' })
  await Promise.race([
    emailField.waitFor({ timeout: 20_000 }).catch(() => {}),
    todayHeading.waitFor({ timeout: 20_000 }).catch(() => {}),
  ])
  if (await emailField.isVisible().catch(() => false)) {
    log('signing in as', EMAIL)
    await emailField.fill(EMAIL)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await todayHeading.waitFor({ timeout: 25_000 })
}

/**
 * Both entry sheets open on the contact picker. Prefer the named donor (the
 * fixtures' Dovid Cohen, who has history, a declaration and an open pledge);
 * against a live database with a different cast, take whoever is first.
 */
async function pickContact(dialog, term) {
  const search = dialog.getByLabel('Search contacts')
  if (!(await search.isVisible().catch(() => false))) return
  await search.fill(term)
  await dialog.page().waitForTimeout(400)
  const named = dialog.getByRole('button', { name: new RegExp(term, 'i') })
  if (await named.count()) {
    await named.first().click()
    return
  }
  await search.fill('')
  await dialog.page().waitForTimeout(400)
  const first = dialog.locator('div.overflow-y-auto button').first()
  if (await first.count()) {
    log('picker: no match for', term, '— taking the first contact')
    await first.click()
  } else {
    log('picker: no contacts at all — the sheet stays on the picker')
  }
}

async function main() {
  await mkdir(SHOTS, { recursive: true })

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))

  try {
    log('opening', BASE)
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await signInIfNeeded(page)

    // 1 — the Giving screen: metric cards + the recent-gifts table.
    await page.goto(`${BASE}/giving`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Giving' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('m4-giving') })
    log('wrote', shot('m4-giving'))
    log('metrics:', (await page.locator('main').innerText()).split('\n').slice(0, 14).join(' | '))

    // 2 — the thanks queue (05 §3): the 48h norm, big gifts flagged.
    const thanks = page.getByRole('tab', { name: /Needs thanks/ })
    if (await thanks.count()) {
      await thanks.click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: shot('m4-thanks') })
      log('wrote', shot('m4-thanks'))
    }

    // 3 — gift entry with the ask array, the Gift Aid line and a tribute open.
    await page.getByRole('tab', { name: /Recent gifts/ }).click()
    await page.getByRole('button', { name: /Record gift/ }).click()
    let dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 10_000 })
    await pickContact(dialog, 'Dovid')
    await page.waitForTimeout(900)

    const chip = dialog.getByRole('button', { name: /Highest \+25%/ })
    if (await chip.count()) await chip.first().click()
    const tribute = dialog.getByLabel(/in honour \/ in memory/i)
    if (await tribute.count()) await tribute.check()
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('m4-gift-entry') })
    log('wrote', shot('m4-gift-entry'))
    log('sheet:', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 320))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    // 4 — the pledge sheet: schedule builder with the live sum check (05 §2).
    await page.getByRole('button', { name: 'Record pledge' }).click()
    dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 10_000 })
    await pickContact(dialog, 'Dovid')
    await page.waitForTimeout(700)
    await dialog.getByLabel('Pledged total').fill('5000')
    await dialog.getByLabel('Number of installments').fill('5')
    await dialog.getByRole('button', { name: 'Generate' }).click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('m4-pledge') })
    log('wrote', shot('m4-pledge'))
    log('schedule:', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 320))
    await page.keyboard.press('Escape')

    // 5 — the pledge cards and the failing standing order.
    await page.getByRole('tab', { name: /Pledges/ }).click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: shot('m4-pledge-cards') })
    log('wrote', shot('m4-pledge-cards'))

    await page.getByRole('tab', { name: /Recurring/ }).click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: shot('m4-recurring') })
    log('wrote', shot('m4-recurring'))

    // 6 — the profile entry point: the Giving tab's "Record gift" opens the
    // same sheet already bound to this donor (04 §5.3 → 05 §1).
    await page.getByRole('tab', { name: /Recent gifts/ }).click()
    await page.waitForTimeout(500)
    const donorLink = page.locator('table a[href^="/contacts/"]').first()
    if ((await donorLink.count()) === 0) {
      log('no gifts in the ledger yet — skipping the profile entry-point shot')
      if (errors.length > 0) log('console errors:', errors.slice(0, 6))
      else log('no console errors')
      return
    }
    await donorLink.click()
    await page.getByRole('tab', { name: 'Giving' }).click()
    await page.waitForTimeout(900)
    const profileGift = page.getByRole('button', { name: 'Record gift' })
    if (await profileGift.count()) {
      await profileGift.first().click()
      dialog = page.getByRole('dialog')
      await dialog.waitFor({ timeout: 10_000 })
      await page.waitForTimeout(700)
      await page.screenshot({ path: shot('m4-profile-gift') })
      log('wrote', shot('m4-profile-gift'))
      log('profile sheet:', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 180))
      await page.keyboard.press('Escape')
    } else {
      log('profile Giving tab has no Record gift button — check the role gate')
    }

    if (errors.length > 0) log('console errors:', errors.slice(0, 6))
    else log('no console errors')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m4] failed:', error)
  process.exit(1)
})
