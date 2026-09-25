#!/usr/bin/env node
/**
 * M8 screenshots — the Reports gallery, a drill-through sheet and the
 * per-campaign page.
 *
 * Against the offline fixtures (no database needed):
 *
 *   node e2e/reports-fixture-server.mjs --port 5294
 *   VITE_SUPABASE_URL=http://127.0.0.1:5294 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5194 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5194 E2E_SHOT_SUFFIX=fixtures node e2e/m8-shots.mjs
 *
 * Against the live project (sandboxed Chromium cannot open TLS to
 * *.supabase.co, hence the relay — see e2e/supabase-relay.mjs):
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs
 *   VITE_SUPABASE_URL=http://127.0.0.1:5433 npx vite --port 5194 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5194 E2E_SHOT_SUFFIX=live node e2e/m8-shots.mjs
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5194'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'YeshivaCrm-demo1'
const SUFFIX = process.env.E2E_SHOT_SUFFIX ? `-${process.env.E2E_SHOT_SUFFIX}` : ''

const log = (...args) => console.log('[m8]', ...args)
const shot = (name) => join(SHOTS, `${name}${SUFFIX}.png`)

async function signInIfNeeded(page) {
  const emailField = page.getByLabel('Email')
  await Promise.race([
    emailField.waitFor({ timeout: 20_000 }).catch(() => {}),
    page.getByRole('heading', { name: 'Reports' }).waitFor({ timeout: 20_000 }).catch(() => {}),
  ])
  if (await emailField.isVisible().catch(() => false)) {
    log('signing in as', EMAIL)
    await emailField.fill(EMAIL)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    // Wait for the form to go: reloading before supabase-js has persisted the
    // session drops us straight back onto the login screen.
    await emailField.waitFor({ state: 'detached', timeout: 25_000 })
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
    log('opening', `${BASE}/reports`)
    await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' })
    await signInIfNeeded(page)
    await page.goto(`${BASE}/reports`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Reports' }).waitFor({ timeout: 25_000 })
    await page.locator('[aria-label="Donor retention"]').waitFor({ timeout: 25_000 })
    // Park the virtual pointer off-canvas: it is still sitting where the sign-in
    // button was, which would leave a hover state on whatever is now under it.
    await page.mouse.move(0, 0)
    await page.waitForTimeout(1200)

    await page.screenshot({ path: shot('m8-reports'), fullPage: true })
    log('wrote', shot('m8-reports'))

    // Prove the chart rules held: rounded data-ends on the baseline, benchmark
    // bars, a peak label and one <title> tooltip per mark.
    const chart = await page.evaluate(() => {
      const marks = [...document.querySelectorAll('[data-testid="bar-mark"]')]
      const first = marks.find((mark) => mark.querySelector('rect[rx="4"]'))
      const rounded = first?.querySelector('rect[rx="4"]')
      const rects = first ? [...first.querySelectorAll('rect')] : []
      return {
        marks: marks.length,
        titles: document.querySelectorAll('[data-testid="bar-mark"] title').length,
        rounded: rounded ? { rx: rounded.getAttribute('rx'), y: rounded.getAttribute('y'), h: rounded.getAttribute('height') } : null,
        baseRect: rects[2] ? { y: rects[2].getAttribute('y'), h: rects[2].getAttribute('height') } : null,
        peak: document.querySelector('[data-testid="peak-label"]')?.textContent ?? null,
        benchmarkBars: document.querySelectorAll('[data-testid="benchmark-bar"]').length,
        rfmTiles: document.querySelectorAll('[data-testid="rfm-tile"]').length,
        alerts: document.querySelectorAll('[data-testid="rfm-tile"][data-alert="true"]').length,
        drillNumbers: document.querySelectorAll('[data-testid="drill-number"]').length,
        amountsHidden: Boolean(document.querySelector('[data-testid="amounts-hidden-note"]')),
      }
    })
    log('chart:', JSON.stringify(chart))

    const cards = await page.locator('section[aria-label] h2').allInnerTexts()
    log('cards:', cards.join(' | '))

    const retention = await page.locator('[aria-label="Donor retention"]').innerText()
    log('retention:', retention.replace(/\n+/g, ' | ').slice(0, 220))

    // The drill sheet — "…and here are the people" (06 §3).
    const lapsed = page.getByRole('button', { name: /^Lapsed:/ })
    if (await lapsed.count()) {
      await lapsed.first().click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ timeout: 15_000 })
      await page.waitForTimeout(900)
      await page.screenshot({ path: shot('m8-reports-drill') })
      log('wrote', shot('m8-reports-drill'))
      log('drill:', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 200))
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    } else {
      log('no lapsed count on screen — skipped the drill shot')
    }

    // The per-campaign page (05 §4).
    const campaignLink = page.getByRole('link', { name: /campaign page →/ }).first()
    if (await campaignLink.count()) {
      await campaignLink.click()
      await page.locator('[data-testid="progress-ring"]').waitFor({ timeout: 20_000 })
      await page.mouse.move(0, 0)
      await page.waitForTimeout(1000)
      await page.screenshot({ path: shot('m8-campaign'), fullPage: true })
      log('wrote', shot('m8-campaign'))
      const sections = await page.locator('section[aria-label] h2').allInnerTexts()
      log('campaign sections:', sections.join(' | '))
      log(
        'ring:',
        await page.locator('[data-testid="progress-ring"]').getAttribute('aria-label'),
      )
    } else {
      log('no campaign on screen — skipped the campaign shot')
    }

    if (errors.length > 0) log('console errors:', errors.slice(0, 6))
    else log('no console errors')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m8] failed:', error)
  process.exit(1)
})
