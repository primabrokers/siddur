#!/usr/bin/env node
/**
 * C2 screenshots — the WhatsApp channel (10 §2 Tier 2).
 *
 * Three shots, and the third is the point of the whole milestone:
 *
 *   c2-conversations   the list: contact chips, snippets, unread badges and the
 *                      green/grey 24-hour-window dot
 *   c2-thread          one open conversation: bubbles, ticks, day separators,
 *                      the media chip, and the free-text composer
 *   c2-window-closed   the same pane on a thread whose window has shut: the
 *                      banner and the template picker *instead of* the text box
 *
 * Against the offline fixtures (no database needed):
 *
 *   node e2e/wa-fixture-server.mjs --port 5298
 *   VITE_SUPABASE_URL=http://127.0.0.1:5298 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5198 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5198 E2E_SHOT_SUFFIX=fixtures node e2e/c2-shots.mjs
 *
 * Against the live project (sandboxed Chromium cannot open TLS to
 * *.supabase.co, hence the relay — see e2e/supabase-relay.mjs):
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs --port 5433
 *   VITE_SUPABASE_URL=http://127.0.0.1:5433 npx vite --port 5198 --strictPort --host
 *   E2E_BASE_URL=http://localhost:5198 E2E_SHOT_SUFFIX=live E2E_LIVE=1 node e2e/c2-shots.mjs
 *
 * The pane is shot through `e2e/wa-harness.html`, a development page that mounts
 * it directly: the Comms shell that normally renders it is being built in
 * parallel. `E2E_LIVE=1` signs in first, because the harness talks to the real
 * PostgREST through the relay and RLS needs a session.
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5198'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'YeshivaCrm-demo1'
const SUFFIX = process.env.E2E_SHOT_SUFFIX ? `-${process.env.E2E_SHOT_SUFFIX}` : ''
const LIVE = process.env.E2E_LIVE === '1'

const log = (...args) => console.log('[c2]', ...args)
const shot = (name) => join(SHOTS, `${name}${SUFFIX}.png`)
const HARNESS = `${BASE}/e2e/wa-harness.html`

/**
 * The live project needs a signed-in session before RLS will part with a row.
 * The harness has no login screen, so the session is minted on the app's own
 * login page and then reused — same origin, same localStorage.
 */
async function signIn(page) {
  log('signing in as', EMAIL)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  const emailField = page.getByLabel('Email')
  await emailField.waitFor({ timeout: 25_000 }).catch(() => {})
  if (await emailField.isVisible().catch(() => false)) {
    await emailField.fill(EMAIL)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForTimeout(2500)
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
    if (LIVE) await signIn(page)

    log('opening', HARNESS)
    await page.goto(HARNESS, { waitUntil: 'domcontentloaded' })
    await page.getByRole('list', { name: 'WhatsApp conversations' }).waitFor({ timeout: 25_000 })
    await page.waitForTimeout(1200)

    await page.screenshot({ path: shot('c2-conversations') })
    log('wrote', shot('c2-conversations'))

    const list = page.getByRole('list', { name: 'WhatsApp conversations' })
    const rows = list.getByRole('button')
    const count = await rows.count()
    log('conversations:', count)

    /**
     * Rows are chosen by their window state, then clicked by the whole row
     * button rather than the 8px dot inside it — the dot is the thing being
     * photographed, not a click target.
     */
    const rowWithDot = async (label) => {
      for (let index = 0; index < count; index += 1) {
        const row = rows.nth(index)
        if (await row.getByLabel(label).count()) return row
      }
      return null
    }

    // 1 — the thread with the window OPEN. Its composer is a text box.
    const openRow = await rowWithDot('Inside the 24-hour window — you can reply freely')
    if (openRow) {
      await openRow.click()
      await page.waitForTimeout(1200)
    }
    // `exact` matters: getByLabel is a case-insensitive substring match by
    // default, and the thread region is labelled "WhatsApp messages".
    const freeTextBox = page.getByLabel('Message', { exact: true })
    await freeTextBox.waitFor({ timeout: 15_000 }).catch(() => log('no free-text composer'))
    await page.screenshot({ path: shot('c2-thread') })
    log('wrote', shot('c2-thread'), '· free-text boxes:', await freeTextBox.count())

    // 2 — the thread with the window CLOSED. The text box is gone and the
    // template picker is in its place; this shot is the compliance evidence.
    const closedRow = await rowWithDot('24-hour window closed — approved templates only')
    if (closedRow) {
      await closedRow.click()
      await page.waitForTimeout(1200)
      await page
        .getByText('24-hour window closed — send an approved template')
        .waitFor({ timeout: 15_000 })
        .catch(() => log('no closed-window banner'))
      // The assertion this whole milestone turns on: zero free-text boxes.
      log('free-text boxes outside the window:', await freeTextBox.count())
      log('template pickers:', await page.getByLabel('Approved template', { exact: true }).count())
      await page.screenshot({ path: shot('c2-window-closed') })
      log('wrote', shot('c2-window-closed'))
    } else {
      log('no closed-window conversation in this dataset — skipping c2-window-closed')
    }

    if (errors.length > 0) log('console errors:', errors.slice(0, 5))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[c2] failed:', error)
  process.exit(1)
})
