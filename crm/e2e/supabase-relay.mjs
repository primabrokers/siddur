#!/usr/bin/env node
/**
 * Local Supabase relay — an **e2e harness only** helper.
 *
 * The sandboxed Chromium used for screenshots cannot open TLS to
 * *.supabase.co directly (egress goes through an authenticated proxy whose CA
 * the browser profile does not carry). Node can, so this forwards every
 * request from `http://127.0.0.1:<port>` to the project URL, preserving method,
 * headers, body and status, and adds permissive CORS for the dev origin.
 *
 * Run it, then start Vite with `VITE_SUPABASE_URL=http://127.0.0.1:<port>`.
 * Nothing in `src/` knows about it and it never ships.
 *
 *   node e2e/supabase-relay.mjs [--port 5433] [--target https://…supabase.co]
 */

import { createServer } from 'node:http'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : fallback
}

const PORT = Number(arg('port', process.env.RELAY_PORT ?? 5433))
const TARGET = (arg('target', process.env.VITE_SUPABASE_URL) ?? 'https://zyvhcnhablkgbsgtljma.supabase.co')
  .replace(/\/$/, '')

const HOP_BY_HOP = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authorization',
  'proxy-connection',
  'origin',
  'referer',
  'accept-encoding',
  'content-length',
])

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD',
  'access-control-allow-headers':
    'authorization,apikey,content-type,prefer,range,x-client-info,accept-profile,content-profile,x-supabase-api-version',
  'access-control-expose-headers': 'content-range,content-length,x-supabase-api-version',
  'access-control-max-age': '86400',
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return chunks.length > 0 ? Buffer.concat(chunks) : undefined
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }

  const headers = {}
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key) && typeof value === 'string') headers[key] = value
  }

  try {
    const upstream = await fetch(`${TARGET}${req.url}`, {
      method: req.method,
      headers,
      body: await readBody(req),
      redirect: 'manual',
    })
    const out = { ...CORS }
    for (const [key, value] of upstream.headers.entries()) {
      if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key)) out[key] = value
    }
    const buffer = Buffer.from(await upstream.arrayBuffer())
    res.writeHead(upstream.status, out)
    res.end(buffer)
  } catch (error) {
    res.writeHead(502, { ...CORS, 'content-type': 'application/json' })
    res.end(JSON.stringify({ message: `relay failed: ${error.message}` }))
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[relay] 127.0.0.1:${PORT} → ${TARGET}`)
})
