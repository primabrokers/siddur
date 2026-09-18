#!/usr/bin/env node
/**
 * M7 screenshots — the Gift Aid workspace (05 §5, artboard A7) and the
 * Review & export flow.
 *
 * Against the offline fixtures (no database needed):
 *
 *   node e2e/giftaid-fixture-server.mjs --port 5293
 *   VITE_SUPABASE_URL=http://127.0.0.1:5293 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5193 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5193 E2E_SHOT_SUFFIX=fixtures node e2e/m7-shots.mjs
 *
 * Against the live project (sandboxed Chromium cannot open TLS to
 * *.supabase.co, hence the relay — see e2e/supabase-relay.mjs):
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs --port 5433
 *   VITE_SUPABASE_URL=http://127.0.0.1:5433 npx vite --port 5193 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5193 E2E_SHOT_SUFFIX=live node e2e/m7-shots.mjs
 *
 * `E2E_SKIP_EXPORT=1` takes the workspace shot only — used on the live run, so
 * nothing opens the submit dialog against real claim data.
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5193'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'YeshivaCrm-demo1'
const SUFFIX = process.env.E2E_SHOT_SUFFIX ? `-${process.env.E2E_SHOT_SUFFIX}` : ''
const SKIP_EXPORT = process.env.E2E_SKIP_EXPORT === '1'

const log = (...args) => console.log('[m7]', ...args)
const shot = (name) => join(SHOTS, `${name}${SUFFIX}.png`)

async function signInIfNeeded(page) {
  const emailField = page.getByLabel('Email')
  const anyHeading = page.getByRole('heading', { name: /Today|Gift Aid/ })
  await Promise.race([
    emailField.waitFor({ timeout: 20_000 }).catch(() => {}),
    anyHeading.waitFor({ timeout: 20_000 }).catch(() => {}),
  ])
  if (await emailField.isVisible().catch(() => false)) {
    log('signing in as', EMAIL)
    await emailField.fill(EMAIL)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
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
    log('opening', `${BASE}/gift-aid`)
    await page.goto(`${BASE}/gift-aid`, { waitUntil: 'domcontentloaded' })
    await signInIfNeeded(page)

    // The login screen lands on Today; walk to the workspace from there.
    await page.waitForTimeout(1200)
    if (!page.url().includes('/gift-aid')) {
      await page.goto(`${BASE}/gift-aid`, { waitUntil: 'domcontentloaded' })
    }
    await page.getByRole('heading', { name: 'Gift Aid' }).waitFor({ timeout: 25_000 })
    await page.getByRole('region', { name: 'Current Gift Aid claim' }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1800)

    await page.screenshot({ path: shot('m7-giftaid') })
    log('wrote', shot('m7-giftaid'))
    log(
      'hero:',
      (await page.getByRole('region', { name: 'Current Gift Aid claim' }).innerText()).replace(/\n+/g, ' | '),
    )
    log(
      'queue:',
      (await page.getByRole('region', { name: 'Missing declarations' }).innerText())
        .split('\n')
        .slice(0, 4)
        .join(' | '),
    )

    if (!SKIP_EXPORT) {
      const review = page.getByRole('button', { name: /Review & export HMRC CSV/ })
      if (await review.count()) {
        await review.click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor({ timeout: 15_000 })
        await page.waitForTimeout(1200)
        await page.screenshot({ path: shot('m7-export') })
        log('wrote', shot('m7-export'))
        log('review:', (await dialog.innerText()).replace(/\n+/g, ' | ').slice(0, 320))
        await page.keyboard.press('Escape')
      } else {
        log('no Review & export button (not an admin?) — skipped the export shot')
      }
    }

    if (errors.length > 0) log('console errors:', errors.slice(0, 6))
    else log('no console errors')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m7] failed:', error)
  process.exit(1)
})
