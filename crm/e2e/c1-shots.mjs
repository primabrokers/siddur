#!/usr/bin/env node
/**
 * C1 screenshots — the inbox list, a thread being read, the compose sheet, and
 * the mobile stack.
 *
 * Against the offline fixtures (no database needed):
 *
 *   node e2e/comms-fixture-server.mjs --port 5297 &
 *   VITE_SUPABASE_URL=http://127.0.0.1:5297 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5197 --strictPort --host &
 *   E2E_BASE_URL=http://localhost:5197 E2E_SHOT_SUFFIX=fixtures node e2e/c1-shots.mjs
 *
 * Against the live project (sandboxed Chromium cannot open TLS to
 * *.supabase.co, hence the relay — see e2e/supabase-relay.mjs):
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs &
 *   VITE_SUPABASE_URL=http://127.0.0.1:5433 npx vite --port 5197 --strictPort --host &
 *   E2E_BASE_URL=http://localhost:5197 E2E_SHOT_SUFFIX=live node e2e/c1-shots.mjs
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5197'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'YeshivaCrm-demo1'
const SUFFIX = process.env.E2E_SHOT_SUFFIX ? `-${process.env.E2E_SHOT_SUFFIX}` : ''

const log = (...args) => console.log('[c1]', ...args)
const shot = (name) => join(SHOTS, `${name}${SUFFIX}.png`)

async function signInIfNeeded(page) {
  const emailField = page.getByLabel('Email')
  // `exact`: with an empty task list the Today page also carries the reward
  // state's "Everyone's taken care of today" heading.
  const todayHeading = page.getByRole('heading', { name: 'Today', exact: true })
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

    /* ------------------------------------------------------------ inbox */

    await page.goto(`${BASE}/comms`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('c1-inbox') })
    log('wrote', shot('c1-inbox'))
    log('rail:', (await page.locator('nav[aria-label="Inbox channels"]').innerText()).replace(/\n+/g, ' | '))

    /* ----------------------------------------------------------- thread */

    const firstThread = page.getByTestId('email-list').getByRole('button').first()
    if (await firstThread.count()) {
      await firstThread.click()
      await page.getByTestId('email-thread').waitFor({ timeout: 10_000 })
      await page.waitForTimeout(900)
      await page.screenshot({ path: shot('c1-thread') })
      log('wrote', shot('c1-thread'))
      log(
        'thread:',
        (await page.getByTestId('email-thread').innerText()).replace(/\n+/g, ' | ').slice(0, 220),
      )
    } else {
      log('no conversation to open — skipped the thread shot')
    }

    /* ---------------------------------------------------------- compose */

    const reply = page.getByRole('button', { name: 'Reply', exact: true }).first()
    if (await reply.count()) {
      await reply.click()
    } else {
      await page.getByRole('button', { name: 'New email' }).first().click()
    }
    await page.getByRole('dialog').waitFor({ timeout: 10_000 })
    await page.waitForTimeout(700)
    await page.screenshot({ path: shot('c1-compose') })
    log('wrote', shot('c1-compose'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)

    /* ----------------------------------------------------------- mobile */

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${BASE}/comms`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1400)
    await page.screenshot({ path: shot('c1-inbox-mobile') })
    log('wrote', shot('c1-inbox-mobile'))

    if (errors.length > 0) log('console errors:', errors.slice(0, 6))
    else log('no console errors')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[c1] failed:', error)
  process.exit(1)
})
