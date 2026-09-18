#!/usr/bin/env node
/**
 * M5 screenshots — global search ("/"), the command palette (⌘K), the
 * contacts views bar (06 §1) and the Settings screen (06 §4).
 *
 * Against the offline fixtures (no database needed):
 *
 *   node e2e/fixture-server.mjs --port 5434
 *   VITE_SUPABASE_URL=http://127.0.0.1:5434 VITE_SUPABASE_ANON_KEY=fixture npm run dev
 *   E2E_SHOT_SUFFIX=fixtures node e2e/m5-shots.mjs
 *
 * Against the live project (sandboxed Chromium cannot open TLS to
 * *.supabase.co, hence the relay — see e2e/supabase-relay.mjs):
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs
 *   VITE_SUPABASE_URL=http://127.0.0.1:5433 npm run dev
 *   E2E_SHOT_SUFFIX=live node e2e/m5-shots.mjs
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

const log = (...args) => console.log('[m5]', ...args)
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

async function main() {
  await mkdir(SHOTS, { recursive: true })

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })
  const errors = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.push(String(error)))

  try {
    log('opening', BASE)
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await signInIfNeeded(page)
    await page.waitForTimeout(1500)

    /* ------------------------------------------------------------ search */
    await page.keyboard.press('/')
    const searchField = page.getByRole('combobox', { name: 'Search people, phones, cities' })
    await searchField.waitFor({ timeout: 10_000 })
    await searchField.type('cohen', { delay: 40 })
    // 150ms debounce + the query; the budget is 300ms perceived (11 §5).
    await page.waitForTimeout(900)
    await page.screenshot({ path: shot('m5-search') })
    log('wrote', shot('m5-search'))
    log(
      'results:',
      (await page.getByRole('option').allInnerTexts()).slice(0, 4).map((t) => t.replace(/\n+/g, ' · ')).join(' | ') ||
        '(none)',
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    /* ----------------------------------------------------------- palette */
    await page.keyboard.press('Control+k')
    const commandField = page.getByRole('combobox', { name: 'Type a command' })
    await commandField.waitFor({ timeout: 10_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('m5-palette') })
    log('wrote', shot('m5-palette'))
    log(
      'commands:',
      (await page.getByRole('option').allInnerTexts()).slice(0, 6).map((t) => t.replace(/\n+/g, ' ')).join(' | '),
    )
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    /* ------------------------------------------------------------- views */
    await page.goto(`${BASE}/contacts`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('region', { name: 'Views' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1200)

    const lybunt = page.getByRole('region', { name: 'Views' }).getByRole('button', { name: /^LYBUNT/ })
    if (await lybunt.count()) {
      await lybunt.click()
      await page.waitForTimeout(900)
    } else {
      log('no LYBUNT view in this dataset — shooting the unfiltered bar')
    }
    await page.screenshot({ path: shot('m5-views') })
    log('wrote', shot('m5-views'))
    log('heading:', await page.getByRole('heading', { level: 1 }).first().innerText())
    log(
      'pinned:',
      (await page.locator('nav[aria-label="Primary"]').first().innerText()).replace(/\n+/g, ' · ').slice(0, 220),
    )

    /* ---------------------------------------------------------- settings */
    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor({ timeout: 20_000 })
    await page.getByRole('tab', { name: 'Automation rules' }).click()
    await page.waitForTimeout(1200)
    await page.screenshot({ path: shot('m5-settings') })
    log('wrote', shot('m5-settings'))
    log(
      'rules:',
      (await page.locator('main section li').allInnerTexts()).slice(0, 3).map((t) => t.replace(/\n+/g, ' · ').slice(0, 90)).join(' | '),
    )

    // The lookup editor is the other half of 06 §4 — worth one line of proof.
    await page.getByRole('tab', { name: 'Lookups' }).click()
    await page.waitForTimeout(800)
    await page.screenshot({ path: shot('m5-settings-lookups') })
    log('wrote', shot('m5-settings-lookups'))

    if (errors.length > 0) log('console errors:', errors.slice(0, 6))
    else log('no console errors')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m5] failed:', error)
  process.exit(1)
})
