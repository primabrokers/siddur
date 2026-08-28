#!/usr/bin/env node
/**
 * Phase-1 stragglers browser check — the import wizard, the merge tool and the
 * contacts list's bulk sheet, photographed at desktop width (06 §5, 03 §4).
 *
 *   node e2e/import-fixture-server.mjs --port 5291
 *   VITE_SUPABASE_URL=http://127.0.0.1:5291 VITE_SUPABASE_ANON_KEY=fixture \
 *     npx vite --port 5191 --strictPort --host
 *   node e2e/p1x-shots.mjs
 *
 * Writes e2e/shots/p1x-{wizard,mapping,dryrun,merge,bulk}-fixtures.png.
 */

import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const SHOTS = join(HERE, 'shots')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:5191'
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.test'
const PASSWORD = process.env.E2E_PASSWORD ?? 'YeshivaCrm-demo1'
const SUFFIX = process.env.E2E_SHOT_SUFFIX ?? 'fixtures'

/** A sheet with the shape the spec cares about: contacts *and* gifts. */
const SHEET = [
  'First Name,Surname,E-mail Address,Mobile,Town,Amount,Date Given,Fund',
  'SHLOIMY,fischer,shloimy@example.com,07700 900321,hendon,500,15/03/2024,General',
  'malky,gross,malky@example.com,07700 900322,manchester,250,02/04/2024,Building Fund',
  'David,Cohen,,07700 900123,,1000,20/03/2024,General',
  'yitzchok,brodie,yitzchok@example.com,07700 900324,london,180,11/05/2024,Kollel',
  'RIVKY,fischer,rivky@example.com,,hendon,,,',
].join('\n')

const log = (...args) => console.log('[p1x]', ...args)
const shot = (name) => join(SHOTS, `p1x-${name}-${SUFFIX}.png`)

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
    await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' })

    const emailField = page.getByLabel('Email')
    await Promise.race([
      emailField.waitFor({ timeout: 20_000 }).catch(() => {}),
      page.getByText('Drop the spreadsheet here').waitFor({ timeout: 20_000 }).catch(() => {}),
    ])
    if (await emailField.isVisible().catch(() => false)) {
      log('signing in as', EMAIL)
      await emailField.fill(EMAIL)
      await page.getByLabel('Password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForTimeout(1200)
      await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' })
    }

    /* ------------------------------------------------------ 1 · the wizard */
    await page.getByText('Drop the spreadsheet here').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: shot('wizard') })
    log('wrote', shot('wizard'))

    /* ----------------------------------------------------- 2 · the mapping */
    await page.setInputFiles('input[type=file]', {
      name: 'yeshiva-book.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(SHEET, 'utf-8'),
    })
    await page.getByText('Column in the file').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('mapping') })
    log('wrote', shot('mapping'))
    log(
      'guessed:',
      await page.getByLabel('What "Mobile" imports as').inputValue(),
      await page.getByLabel('What "Date Given" imports as').inputValue(),
    )

    /* ------------------------------------------- 3 · preview → dedupe → dry run */
    await page.getByTestId('import-next').click()
    await page.getByTestId('import-preview-table').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: shot('preview') })
    log('wrote', shot('preview'))

    await page.getByTestId('import-next').click()
    await page.waitForTimeout(900)
    await page.screenshot({ path: shot('dedupe') })
    log('wrote', shot('dedupe'))

    await page.getByTestId('import-next').click()
    const sentence = page.getByTestId('dryrun-sentence')
    await sentence.waitFor({ timeout: 20_000 })
    await page.waitForTimeout(300)
    await page.screenshot({ path: shot('dryrun') })
    log('wrote', shot('dryrun'))
    log('dry run reads:', (await sentence.innerText()).replace(/\s+/g, ' '))

    /* ------------------------------------------------------- 4 · the merge */
    await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('tab', { name: 'Duplicates' }).click()
    await page.getByTestId('duplicates-list').waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Open pair' }).first().click()
    await page.getByTestId('merge-winner').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('merge') })
    log('wrote', shot('merge'))
    log('survivor:', (await page.getByTestId('merge-winner').innerText()).replace(/\n+/g, ' | '))

    /* -------------------------------------------- 5 · bulk sheet + columns */
    await page.goto(`${BASE}/contacts`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { level: 1, name: 'Contacts' }).waitFor({ timeout: 20_000 })

    await page.getByTestId('column-picker').click()
    for (const column of ['Days since contact', 'This year', 'Lifetime']) {
      await page.getByRole('checkbox', { name: column }).check()
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    const boxes = page.locator('li input[type=checkbox]')
    const count = await boxes.count()
    for (let i = 0; i < Math.min(3, count); i += 1) await boxes.nth(i).check()

    await page.getByTestId('bulk-sheet').waitFor({ timeout: 20_000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: shot('bulk') })
    log('wrote', shot('bulk'))
    log('bulk sheet reads:', (await page.getByTestId('bulk-sheet').innerText()).replace(/\n+/g, ' | '))

    if (failures.length > 0) log('console errors:', failures.slice(0, 5))
    else log('no console errors')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[p1x] failed:', error)
  process.exit(1)
})
