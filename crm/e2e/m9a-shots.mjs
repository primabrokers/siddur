#!/usr/bin/env node
/**
 * M9a browser check — walks the three AI surfaces and writes the screenshots
 * the milestone is judged on.
 *
 *   node e2e/ai-fixture-server.mjs --port 5295
 *   VITE_SUPABASE_URL=http://127.0.0.1:5295 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5195 --strictPort
 *   node e2e/m9a-shots.mjs
 *
 * Shots: m9a-brief · m9a-draft · m9a-excluded.
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5195'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'YeshivaCrm-demo1'
const SUFFIX = process.env.E2E_SHOT_SUFFIX ?? 'fixtures'

const DOVID = 'aaaaaaaa-0000-0000-0000-000000000001'

const log = (...args) => console.log('[m9a]', ...args)
const shot = (name) => join(SHOTS, `m9a-${name}-${SUFFIX}.png`)

async function signIn(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  const email = page.getByLabel('Email')
  await Promise.race([
    email.waitFor({ timeout: 20_000 }).catch(() => {}),
    page.getByRole('link', { name: /Contacts/ }).first().waitFor({ timeout: 20_000 }).catch(() => {}),
  ])
  if (await email.isVisible().catch(() => false)) {
    log('signing in as', EMAIL)
    await email.fill(EMAIL)
    await page.getByLabel('Password').fill(PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForTimeout(1200)
  }
}

async function main() {
  await mkdir(SHOTS, { recursive: true })

  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  })
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } })
  const failures = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') failures.push(msg.text())
  })

  try {
    await signIn(page)

    /* ------------------------------------------------------ 1 · the brief */

    log('opening the donor profile')
    await page.goto(`${BASE}/contacts/${DOVID}`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('profile-header').waitFor({ timeout: 20_000 })

    const holding = page.getByTestId('holding-line')
    await holding.waitFor({ timeout: 10_000 })
    log('holding line:', (await holding.innerText()).replace(/\s+/g, ' ').slice(0, 140))

    await page.getByTestId('brief-me').click()
    await page.getByTestId('brief-bullets').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('brief'), fullPage: true })
    log('wrote', shot('brief'))

    const bullets = await page.getByTestId('brief-bullets').locator('li').count()
    log(`brief bullets: ${bullets} (spec says five)`)

    /* ------------------------------------------------------ 2 · the draft */

    log('opening Giving → Needs thanks')
    await page.goto(`${BASE}/giving?tab=thanks`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: /Draft/ }).first().waitFor({ timeout: 20_000 })

    const rows = page.locator('table tbody tr')
    log('thanks queue rows:', await rows.count())

    // Row order is biggest-and-oldest first: Dovid's £5,000 leads.
    await page.getByRole('button', { name: /Draft/ }).first().click()
    await page.getByTestId('draft-facts').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('draft') })
    log('wrote', shot('draft'))
    log('facts panel:', (await page.getByTestId('draft-facts').innerText()).replace(/\n+/g, ' | ').slice(0, 220))

    await page.getByRole('button', { name: 'Close' }).click()
    await page.waitForTimeout(400)

    /* --------------------------------------------- 3 · the hard exclusion */

    log('opening the in-memory gift')
    await page.getByRole('button', { name: /Draft/ }).nth(1).click()
    await page.getByTestId('draft-excluded').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(500)
    await page.screenshot({ path: shot('excluded') })
    log('wrote', shot('excluded'))
    log('refusal:', (await page.getByTestId('draft-excluded').innerText()).replace(/\n+/g, ' | ').slice(0, 260))

    if (failures.length > 0) log('console errors:', failures.slice(0, 5))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[m9a] failed:', error)
  process.exit(1)
})
