#!/usr/bin/env node
/**
 * M2 screenshots — the Action Stream (desktop + mobile), the Tasks view and the
 * close-the-loop dialog.
 *
 * Against the offline fixtures (no database needed):
 *
 *   node e2e/fixture-server.mjs --port 5434
 *   VITE_SUPABASE_URL=http://127.0.0.1:5434 VITE_SUPABASE_ANON_KEY=fixture npm run dev
 *   E2E_SHOT_SUFFIX=fixtures node e2e/m2-shots.mjs
 *
 * Against the live project (sandboxed Chromium cannot open TLS to
 * *.supabase.co, hence the relay — see e2e/supabase-relay.mjs):
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs
 *   VITE_SUPABASE_URL=http://127.0.0.1:5433 npm run dev
 *   E2E_SHOT_SUFFIX=live node e2e/m2-shots.mjs
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

const log = (...args) => console.log('[m2]', ...args)
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

    await page.screenshot({ path: shot('m2-today') })
    log('wrote', shot('m2-today'))
    log(
      'sections:',
      (await page.locator('section > div, section > h2').allInnerTexts())
        .filter((text) => /·|MEETINGS TODAY/.test(text))
        .slice(0, 8)
        .join(' | '),
    )

    // Mobile: the stream only, nudges folded in as cards (04 §1).
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(700)
    await page.screenshot({ path: shot('m2-today-mobile') })
    log('wrote', shot('m2-today-mobile'))

    await page.setViewportSize({ width: 1440, height: 980 })
    await page.waitForTimeout(400)

    // The tasks view.
    await page.goto(`${BASE}/tasks`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Tasks' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1200)
    await page.screenshot({ path: shot('m2-tasks') })
    log('wrote', shot('m2-tasks'))

    // Close the loop (I-4): completing anything opens the follow-up prompt.
    await page.goto(BASE, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1200)
    const complete = page.getByRole('button', { name: /^Complete / }).first()
    if (await complete.count()) {
      await complete.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor({ timeout: 10_000 })
      await page.waitForTimeout(500)
      await page.screenshot({ path: shot('m2-close-the-loop') })
      log('wrote', shot('m2-close-the-loop'))
      log('dialog:', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 220))
      await page.keyboard.press('Escape')
    } else {
      log('no open task to complete — skipped the close-the-loop shot')
    }

    if (errors.length > 0) log('console errors:', errors.slice(0, 6))
    else log('no console errors')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m2] failed:', error)
  process.exit(1)
})
