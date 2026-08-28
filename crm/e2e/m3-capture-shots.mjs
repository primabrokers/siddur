#!/usr/bin/env node
/**
 * M3 browser check — walks Quick Capture's three panes at phone width and
 * writes the screenshots the milestone is judged on.
 *
 *   node e2e/capture-fixture-server.mjs --port 5435
 *   VITE_SUPABASE_URL=http://127.0.0.1:5435 VITE_SUPABASE_ANON_KEY=fixture npm run dev
 *   node e2e/m3-capture-shots.mjs
 *
 * Add `--fallback` (with the fixture server started `--mode unconfigured`) to
 * photograph the manual form the client falls back to when the AI is off.
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
const SUFFIX = process.env.E2E_SHOT_SUFFIX ?? 'fixtures'
const FALLBACK = process.argv.includes('--fallback')

const NOTE =
  'met dovid cohen in london this morning, very warm, strong interest in the building project, discussed twenty k, he wants me to call him after sukkos'

const log = (...args) => console.log('[m3]', ...args)
const shot = (name) => join(SHOTS, `m3-capture-${name}-${SUFFIX}.png`)

async function main() {
  await mkdir(SHOTS, { recursive: true })

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  })
  // The wireframe's phone pane is 390×800.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const failures = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') failures.push(msg.text())
  })

  try {
    log('opening', BASE)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })

    const emailField = page.getByLabel('Email')
    await Promise.race([
      emailField.waitFor({ timeout: 20_000 }).catch(() => {}),
      page.getByRole('button', { name: /capture/i }).first().waitFor({ timeout: 20_000 }).catch(() => {}),
    ])

    if (await emailField.isVisible().catch(() => false)) {
      log('signing in as', EMAIL)
      await emailField.fill(EMAIL)
      await page.getByLabel('Password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForTimeout(1500)
    }

    // Every entry point routes through the provider; the PWA shortcut is the
    // one that does not depend on which chrome is visible at this width.
    log('opening capture via /?capture=1')
    await page.goto(`${BASE}/?capture=1`, { waitUntil: 'domcontentloaded' })

    const box = page.getByLabel('What happened')
    await box.waitFor({ timeout: 20_000 })

    /* ------------------------------------------------------------ pane 1 */
    await box.fill(NOTE)
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('input') })
    log('wrote', shot('input'))

    /* ------------------------------------------------------------ pane 2 */
    await page.getByRole('button', { name: 'Next' }).click()
    const confirmHeading = page.getByRole('heading', { name: FALLBACK ? 'Log by hand' : 'Check & save' })
    await confirmHeading.waitFor({ timeout: 20_000 })
    await page.waitForTimeout(700)
    await page.screenshot({ path: shot('confirm') })
    log('wrote', shot('confirm'))

    if (FALLBACK) {
      // With no parse there is no contact chip: the manual form asks for the
      // name, which is the only thing (besides the summary) that gates Save.
      log('fallback notice:', await page.getByTestId('capture-failure-notice').innerText())
      await page.getByLabel('Contact name').fill('Dovid Cohen')
      await page.waitForTimeout(300)
    } else {
      const chip = page.getByRole('button', { name: 'Change the due date' })
      log('date chip reads:', (await chip.innerText()).replace(/\s+/g, ' '))
      const who = page.getByTestId('capture-contact-matched')
      log('contact chip reads:', (await who.innerText()).replace(/\n+/g, ' | '))
    }

    /* ------------------------------------------------------------ pane 3 */
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByTestId('capture-saved').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('saved') })
    log('wrote', shot('saved'))
    log('saved pane reads:', (await page.getByTestId('capture-saved').innerText()).replace(/\n+/g, ' | '))

    if (failures.length > 0) log('console errors:', failures.slice(0, 5))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m3] failed:', error)
  process.exit(1)
})
