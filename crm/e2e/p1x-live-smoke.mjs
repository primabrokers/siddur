#!/usr/bin/env node
/**
 * Live smoke: import five rows into the real project, then take them back out.
 *
 * This is the one check the offline suites cannot make — that migration 009's
 * `import_batch` stamp, the RLS policies on `import_batches`, and the delete
 * path all behave against Postgres rather than against the in-memory
 * stand-in. It is written to be **self-cleaning**: it commits a batch, reads
 * the done screen, undoes the batch, and reports both counts.
 *
 *   node e2e/supabase-relay.mjs --port 5292
 *   VITE_SUPABASE_URL=http://127.0.0.1:5292 VITE_SUPABASE_ANON_KEY=<publishable> \
 *     npx vite --port 5191 --strictPort --host
 *   node e2e/p1x-live-smoke.mjs
 *
 * The five rows use names no real donor would carry, so a failure part-way
 * through leaves something obvious to find rather than something plausible.
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

const SHEET = [
  'First Name,Surname,E-mail Address,Mobile,Town,Amount,Date Given,Fund',
  'Zzsmoke,Alphatest,zz.alpha@import-smoke.invalid,07700 900801,Hendon,120,04/03/2024,General',
  'Zzsmoke,Betatest,zz.beta@import-smoke.invalid,07700 900802,Edgware,240,05/03/2024,General',
  'Zzsmoke,Gammatest,zz.gamma@import-smoke.invalid,07700 900803,Manchester,,,',
  'Zzsmoke,Deltatest,zz.delta@import-smoke.invalid,07700 900804,London,60,06/03/2024,General',
  'Zzsmoke,Epsilontest,zz.epsilon@import-smoke.invalid,07700 900805,Leeds,90,07/03/2024,General',
].join('\n')

const log = (...args) => console.log('[p1x-live]', ...args)

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
    await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' })

    const emailField = page.getByLabel('Email')
    await Promise.race([
      emailField.waitFor({ timeout: 25_000 }).catch(() => {}),
      page.getByText('Drop the spreadsheet here').waitFor({ timeout: 25_000 }).catch(() => {}),
    ])
    if (await emailField.isVisible().catch(() => false)) {
      log('signing in as', EMAIL)
      await emailField.fill(EMAIL)
      await page.getByLabel('Password').fill(PASSWORD)
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForTimeout(2500)
      await page.goto(`${BASE}/import`, { waitUntil: 'domcontentloaded' })
    }

    await page.getByText('Drop the spreadsheet here').waitFor({ timeout: 25_000 })
    await page.setInputFiles('input[type=file]', {
      name: 'p1x-live-smoke.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(SHEET, 'utf-8'),
    })

    await page.getByText('Column in the file').waitFor({ timeout: 25_000 })
    await page.getByTestId('import-next').click() // preview
    await page.getByTestId('import-preview-table').waitFor({ timeout: 25_000 })
    await page.getByTestId('import-next').click() // dedupe
    await page.waitForTimeout(2500)
    await page.getByTestId('import-next').click() // dry run

    const sentence = page.getByTestId('dryrun-sentence')
    await sentence.waitFor({ timeout: 25_000 })
    log('dry run:', (await sentence.innerText()).replace(/\s+/g, ' '))

    await page.getByTestId('import-commit').click()
    const done = page.getByTestId('import-done')
    await done.waitFor({ timeout: 40_000 })
    log('committed:', (await done.innerText()).replace(/\n+/g, ' | ').slice(0, 220))
    await page.screenshot({ path: join(SHOTS, 'p1x-live-done.png') })

    /* ------------------------------------------------------------- undo */
    await page.getByTestId('import-undo').click()
    const confirm = page.getByRole('button', { name: 'Undo the import' })
    await confirm.waitFor({ timeout: 25_000 })
    await page.waitForTimeout(1500)
    log('undo says:', (await page.getByRole('dialog').innerText()).replace(/\n+/g, ' | ').slice(0, 260))
    await confirm.click()

    const undone = page.getByTestId('import-undone')
    await undone.waitFor({ timeout: 40_000 })
    log('undone:', (await undone.innerText()).replace(/\s+/g, ' '))
    await page.screenshot({ path: join(SHOTS, 'p1x-live-undone.png') })

    if (failures.length > 0) log('console errors:', failures.slice(0, 6))
    else log('no console errors')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error('[p1x-live] failed:', error)
  process.exit(1)
})
