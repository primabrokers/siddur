#!/usr/bin/env node
/**
 * Live smoke for the Pipeline board: move a real ask forward a stage, then
 * close it as lost with a reason — against the real project, through the UI.
 *
 * This is the check the offline suites cannot make: that the two clocks
 * (`stage_entered_at` / `last_moved_forward_at`, 02 §3.9) and migration 010's
 * `opportunities.lost_reason` actually land in Postgres under RLS, rather than
 * in the in-memory stand-in.
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs --port 5293
 *   VITE_SUPABASE_URL=http://127.0.0.1:5293 npx vite --port 5192 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5192 node e2e/m6-live-smoke.mjs
 *
 * It is **not** self-cleaning: it prints the row before and after so the
 * original values can be put back with one `update`. The demo fixture it moves
 * (Feld Brothers) is deliberately the one the stale panel is built around, so
 * restoring it matters — the restore statement is printed at the end.
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5192'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'YeshivaCrm-demo1'
/** The card to push around. Defaults to the Feld Brothers demo ask. */
const CARD = process.env.E2E_OPPORTUNITY ?? 'a0000000-0000-4000-8000-000000000002'
const TO_STAGE = process.env.E2E_TO_STAGE ?? 'solicited'

const log = (...args) => console.log('[m6-live]', ...args)

/**
 * HTML5 drag, in two beats. They have to be separate `evaluate` calls: React
 * records the dragged card in state on `dragstart`, and a `drop` dispatched in
 * the same synchronous block would still be reading the pre-render value.
 */
const beginDrag = (cardSelector) => {
  const card = document.querySelector(cardSelector)
  if (!card) return false
  window.__m6 = new DataTransfer()
  card.dispatchEvent(
    new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: window.__m6 }),
  )
  return true
}

const dropOn = (targetSelector) => {
  const target = document.querySelector(targetSelector)
  if (!target) return false
  const dataTransfer = window.__m6 ?? new DataTransfer()
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }))
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }))
  return true
}

async function dragOnto(page, cardSelector, targetSelector) {
  const started = await page.evaluate(beginDrag, cardSelector)
  await page.waitForTimeout(250)
  const dropped = await page.evaluate(dropOn, targetSelector)
  return started && dropped
}

async function signIn(page) {
  const emailField = page.getByLabel('Email')
  const todayHeading = page.getByRole('heading', { name: 'Today' })
  await Promise.race([
    emailField.waitFor({ timeout: 20_000 }).catch(() => {}),
    todayHeading.waitFor({ timeout: 20_000 }).catch(() => {}),
  ])
  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(EMAIL)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await todayHeading.waitFor({ timeout: 25_000 })
}

async function main() {
  await mkdir(SHOTS, { recursive: true })
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await signIn(page)
    await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Pipeline — active asks' }).waitFor({ timeout: 25_000 })
    await page.waitForTimeout(1200)

    const card = `[data-testid="opportunity-card-${CARD}"]`
    await page.locator(card).waitFor({ timeout: 20_000 }).catch(() => {
      throw new Error(`no card for opportunity ${CARD} on the board`)
    })
    log('before:', (await page.locator(card).innerText()).replace(/\n+/g, ' · '))

    /* ------------------------------------------------ 1. a forward move */
    await dragOnto(page, card, `[data-testid="stage-dropzone-${TO_STAGE}"]`)
    await page.waitForTimeout(1800)
    const column = await page.locator(`[data-testid="stage-dropzone-${TO_STAGE}"] ${card}`).count()
    log(`moved into ${TO_STAGE}:`, column === 1 ? 'yes' : 'NO — the card did not land')

    // The prompt only appears when the advance left no open next move (I-3).
    const prompt = page.getByRole('dialog', { name: /^Moved to/ })
    if (await prompt.count()) {
      log('next-move prompt shown — declining it')
      await page.getByRole('button', { name: 'Not yet' }).click()
      await page.waitForTimeout(300)
    } else {
      log('no next-move prompt — the ask already had one open')
    }

    /* ------------------------------------------------ 2. lost + reason */
    await dragOnto(page, card, '[data-testid="outcome-dropzone-lost"]')
    const dialog = page.getByRole('dialog', { name: 'Record the loss' })
    await dialog.waitFor({ timeout: 10_000 })
    await page.screenshot({ path: join(SHOTS, 'm6-pipeline-lost-live.png') })
    log('wrote', join(SHOTS, 'm6-pipeline-lost-live.png'))

    await dialog.getByLabel(/Why was it lost/).selectOption('timing')
    await dialog.getByRole('button', { name: 'Record it as lost' }).click()
    await page.waitForTimeout(2000)

    const gone = (await page.locator(card).count()) === 0
    log('card left the board:', gone ? 'yes' : 'NO — it is still in a column')

    // The history toggle is the only place a decided ask still shows.
    const historyToggle = page.getByRole('button', { name: /Won & lost/ })
    if (await historyToggle.count()) {
      await historyToggle.click()
      await page.waitForTimeout(500)
      const panel = page.getByRole('complementary', { name: 'Stale prospects' })
      log('history:', (await panel.innerText()).replace(/\n+/g, ' · ').slice(0, 200))
    }

    log('errors:', errors.length === 0 ? 'none' : errors.join(' | '))
    log(
      'restore with:  update opportunities set status=\'open\', closed_on=null, lost_reason=null,',
      "stage='<original>', stage_entered_at='<original>', last_moved_forward_at='<original>'",
      `where id='${CARD}';`,
    )
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m6-live] failed:', error)
  process.exit(1)
})
