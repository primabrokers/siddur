#!/usr/bin/env node
/**
 * M9b browser check — the profile's Journeys panel with its attach preview
 * (08 §4), and the Settings calendar-feed line (10 §4), photographed at
 * desktop width.
 *
 *   node e2e/journeys-fixture-server.mjs --port 5296
 *   VITE_SUPABASE_URL=http://127.0.0.1:5296 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5196 --strictPort --host
 *   node e2e/m9b-shots.mjs
 *
 * Writes e2e/shots/m9b-{journey,settings-ics}-fixtures.png.
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5196'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'YeshivaCrm-demo1'
const SUFFIX = process.env.E2E_SHOT_SUFFIX ?? 'fixtures'
const ADLER = 'aaaaaaaa-0000-0000-0000-000000000001'

const log = (...args) => console.log('[m9b]', ...args)
const shot = (name) => join(SHOTS, `m9b-${name}-${SUFFIX}.png`)

async function signInIfAsked(page, path) {
  const emailField = page.getByLabel('Email')
  if (await emailField.isVisible().catch(() => false)) {
    log('signing in as', EMAIL)
    await emailField.fill(EMAIL)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForTimeout(1200)
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  }
}

async function main() {
  await mkdir(SHOTS, { recursive: true })

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const failures = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') failures.push(msg.text())
  })

  try {
    /* ---------------------------------- 1 · the panel + the attach preview */
    log('opening', `${BASE}/contacts/${ADLER}`)
    await page.goto(`${BASE}/contacts/${ADLER}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    await signInIfAsked(page, `/contacts/${ADLER}`)

    const panel = page.getByTestId('journeys-panel')
    await panel.waitFor({ timeout: 20_000 })
    await page.getByTestId('journey-card').waitFor({ timeout: 20_000 })
    log('card reads:', (await page.getByTestId('journey-card').innerText()).replace(/\n+/g, ' | '))

    // Open the picker and choose the template with a waiting step, so the shot
    // carries both halves: the live journey behind, the dated preview in front.
    await page.getByTestId('journey-attach-open').click()
    await page.getByTestId('journey-attach-sheet').waitFor({ timeout: 20_000 })
    await page.getByRole('radio', { name: /Lapsed reactivation/ }).click()
    await page.getByTestId('journey-preview').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('journey') })
    log('wrote', shot('journey'))
    log('preview reads:', (await page.getByTestId('journey-preview').innerText()).replace(/\n+/g, ' | '))

    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    /* ------------------------------------------ 2 · the Settings feed line */
    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
    await signInIfAsked(page, '/settings')
    await page.getByRole('tab', { name: 'Team' }).click()
    await page.getByTestId('calendar-feed').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('settings-ics') })
    log('wrote', shot('settings-ics'))
    log('feed url:', await page.getByTestId('calendar-feed-url').inputValue())

    if (failures.length > 0) log('console errors:', failures.slice(0, 5))
    else log('no console errors')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m9b] failed:', error)
  process.exit(1)
})
