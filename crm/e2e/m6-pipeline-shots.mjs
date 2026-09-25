#!/usr/bin/env node
/**
 * M6 screenshots — the Pipeline board (06 §2 · artboard A5): the stage columns
 * with their exit criteria, the flag-sorted cards, the rotting wash, the stale
 * panel, and the outcome drop zones a drag reveals.
 *
 * Against the offline fixtures (no database needed):
 *
 *   node e2e/pipeline-fixture-server.mjs --port 5292
 *   VITE_SUPABASE_URL=http://127.0.0.1:5292 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5192 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5192 E2E_SHOT_SUFFIX=fixtures node e2e/m6-pipeline-shots.mjs
 *
 * Against the live project (sandboxed Chromium cannot open TLS to
 * *.supabase.co, hence the relay — see e2e/supabase-relay.mjs):
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs --port 5433
 *   VITE_SUPABASE_URL=http://127.0.0.1:5433 npx vite --port 5192 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5192 E2E_SHOT_SUFFIX=live node e2e/m6-pipeline-shots.mjs
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
const SUFFIX = process.env.E2E_SHOT_SUFFIX ? `-${process.env.E2E_SHOT_SUFFIX}` : ''

const log = (...args) => console.log('[m6]', ...args)
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
 * HTML5 drag has no Playwright primitive that React's synthetic handlers see,
 * so the drag start is dispatched directly — enough to reveal the footer zones
 * the wireframe shows only during a drag.
 */
const dragStart = (selector) => {
  const card = document.querySelector(selector)
  if (!card) return false
  const dataTransfer = new DataTransfer()
  card.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer }))
  return true
}

async function main() {
  await mkdir(SHOTS, { recursive: true })

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))

  try {
    log('opening', BASE)
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await signInIfNeeded(page)

    await page.goto(`${BASE}/pipeline`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Pipeline — active asks' }).waitFor({ timeout: 25_000 })
    await page.waitForTimeout(1500)

    await page.screenshot({ path: shot('m6-pipeline') })
    log('wrote', shot('m6-pipeline'))

    log('header:', (await page.locator('h1').first().innerText()))
    log(
      'totals:',
      (await page.locator('h1').first().locator('xpath=../div').innerText()).replace(/\n+/g, ' '),
    )
    const columns = await page.getByRole('region').all()
    for (const column of columns) {
      const label = await column.getAttribute('aria-label')
      if (!label) continue
      log('column:', label.padEnd(24), '·', (await column.innerText()).split('\n').slice(1, 3).join(' · '))
    }
    const rotting = await page.locator('[data-rotting="true"]').count()
    const yellow = await page.locator('[data-testid^="opportunity-card-"][data-flag="none"]').count()
    log(`cards: ${await page.locator('[data-testid^="opportunity-card-"]').count()} · rotting ${rotting} · no-next-move ${yellow}`)

    const stale = page.getByRole('complementary', { name: 'Stale prospects' })
    if (await stale.count()) log('stale:', (await stale.innerText()).replace(/\n+/g, ' · ').slice(0, 200))

    /* --------------------------------------------- the drag-revealed zones */
    const first = await page.locator('[data-testid^="opportunity-card-"]').first().getAttribute('data-testid')
    if (first) {
      const started = await page.evaluate(dragStart, `[data-testid="${first}"]`)
      if (started) {
        await page.waitForTimeout(400)
        if (await page.getByTestId('outcome-dropzone-won').count()) {
          await page.screenshot({ path: shot('m6-pipeline-drag') })
          log('wrote', shot('m6-pipeline-drag'))
        } else {
          log('drop zones did not appear — synthetic dragstart was not seen')
        }
      }
    }

    if (errors.length > 0) {
      log('console errors:')
      for (const error of errors.slice(0, 8)) log('  -', error)
    } else {
      log('no console errors')
    }
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m6] failed:', error)
  process.exit(1)
})
