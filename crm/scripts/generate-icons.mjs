#!/usr/bin/env node
/**
 * Generates the PWA icons into `public/` with no image dependencies:
 * a teal (#0E6E6B) rounded square with a white "Y", drawn as signed-distance
 * fields and encoded as PNG by hand (zlib + CRC32).
 *
 * Run: npm run icons
 */

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', 'public')

const ACCENT = [0x0e, 0x6e, 0x6b]
const WHITE = [0xff, 0xff, 0xff]

// ---------------------------------------------------------------- geometry --

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Distance from point p to segment ab. */
function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const len2 = abx * abx + aby * aby
  const t = len2 === 0 ? 0 : clamp01((apx * abx + apy * aby) / len2)
  const dx = apx - abx * t
  const dy = apy - aby * t
  return Math.hypot(dx, dy)
}

/** Signed distance to a rounded rectangle centred on the canvas. */
function roundedRectDistance(px, py, size, radius) {
  const half = size / 2
  const qx = Math.abs(px - half) - (half - radius)
  const qy = Math.abs(py - half) - (half - radius)
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
  const inside = Math.min(Math.max(qx, qy), 0)
  return outside + inside - radius
}

/** Smooth 0→1 across `edge` pixels — cheap antialiasing. */
function coverage(distance, edge = 1.2) {
  return clamp01(0.5 - distance / edge)
}

function drawIcon(size) {
  const radius = size * 0.22
  const stroke = size * 0.082
  const s = (v) => v * size

  // The "Y": two arms meeting at the junction, then a stem.
  const junctionX = s(0.5)
  const junctionY = s(0.545)
  const arms = [
    [s(0.315), s(0.3), junctionX, junctionY],
    [s(0.685), s(0.3), junctionX, junctionY],
    [junctionX, junctionY, junctionX, s(0.73)],
  ]

  const pixels = Buffer.alloc(size * size * 4)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5
      const py = y + 0.5

      const squareAlpha = coverage(roundedRectDistance(px, py, size, radius))

      let glyphDist = Infinity
      for (const [ax, ay, bx, by] of arms) {
        const d = distToSegment(px, py, ax, ay, bx, by) - stroke / 2
        if (d < glyphDist) glyphDist = d
      }
      const glyphAlpha = coverage(glyphDist) * squareAlpha

      const r = Math.round(ACCENT[0] * (1 - glyphAlpha) + WHITE[0] * glyphAlpha)
      const g = Math.round(ACCENT[1] * (1 - glyphAlpha) + WHITE[1] * glyphAlpha)
      const b = Math.round(ACCENT[2] * (1 - glyphAlpha) + WHITE[2] * glyphAlpha)

      const i = (y * size + x) * 4
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = Math.round(squareAlpha * 255)
    }
  }

  return pixels
}

// --------------------------------------------------------------- png output --

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([length, typeBuf, data, crc])
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0 // filter type: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// --------------------------------------------------------------------- main --

mkdirSync(publicDir, { recursive: true })

for (const size of [192, 512]) {
  const file = join(publicDir, `icon-${size}.png`)
  writeFileSync(file, encodePng(size, drawIcon(size)))
  console.log(`wrote ${file}`)
}
