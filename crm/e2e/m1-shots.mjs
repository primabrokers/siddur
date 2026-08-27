#!/usr/bin/env node
/**
 * M1 live check — signs in against the live Supabase project, opens the
 * contacts list and the seeded donor's profile, and writes screenshots to
 * `e2e/shots/`.
 *
 * Usage, in three terminals (the relay exists because sandboxed Chromium
 * cannot open TLS to *.supabase.co itself — see e2e/supabase-relay.mjs):
 *
 *   NODE_USE_ENV_PROXY=1 node e2e/supabase-relay.mjs
 *   VITE_SUPABASE_URL=http://127.0.0.1:5433 npm run dev
 *   node e2e/m1-shots.mjs
 *
 * Credentials come from E2E_EMAIL / E2E_PASSWORD, defaulting to the demo
 * fixtures.
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
const TARGET = process.env.E2E_CONTACT ?? 'Dovid Cohen'
/** Set when shooting against e2e/fixture-server.mjs, so the files say so. */
const SUFFIX = process.env.E2E_SHOT_SUFFIX ? `-${process.env.E2E_SHOT_SUFFIX}` : ''

const log = (...args) => console.log('[m1]', ...args)
const shot = (name) => join(SHOTS, `${name}${SUFFIX}.png`)

async function main() {
  await mkdir(SHOTS, { recursive: true })

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })
  const failures = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') failures.push(msg.text())
  })

  try {
    log('opening', BASE)
    await page.goto(`${BASE}/contacts`, { waitUntil: 'domcontentloaded' })

    // The guard redirects to /login until the session resolves; wait for
    // whichever of the two surfaces appears first.
    const emailField = page.getByLabel('Email')
    const contactsHeading = page.getByRole('heading', { name: 'Contacts' })
    await Promise.race([
      emailField.waitFor({ timeout: 20_000 }),
      contactsHeading.waitFor({ timeout: 20_000 }),
    ])

    if (await emailField.isVisible().catch(() => false)) {
      log('signing in as', EMAIL)
      await emailField.fill(EMAIL)
      await page.getByLabel('Password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForURL(/\/contacts/, { timeout: 20_000 })
    }

    await contactsHeading.waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('m1-contacts') })
    log('wrote', shot('m1-contacts'))

    const row = page.getByRole('button', { name: new RegExp(TARGET, 'i') }).first()
    await row.waitFor({ timeout: 15_000 })
    await row.click()

    const header = page.getByTestId('profile-header')
    await header.waitFor({ timeout: 20_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('m1-profile') })
    log('wrote', shot('m1-profile'))

    log('header text:', (await header.innerText()).replace(/\n+/g, ' | '))

    // Mobile reflow — the third of the milestone's acceptance surfaces.
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: shot('m1-profile-mobile') })
    log('wrote', shot('m1-profile-mobile'))

    if (failures.length > 0) log('console errors:', failures.slice(0, 5))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m1] failed:', error)
  process.exit(1)
})
