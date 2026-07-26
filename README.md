# Luach — Jewish calendar, zmanim, Shabbos clock & siddur

A frum-focused day-to-day app: Hebrew calendar (1900–2100), zmanim, a Shabbos-mode
alarm clock, minyan & omer reminders, kiddush levana windows computed from the real
molad, and a weekday siddur streamed from the Sefaria API in three nusachos.

## What's here

| File | What it is |
|---|---|
| `index.html` | Full interactive app mockup: Today / Luach / Clock / Siddur / Reminders / Menu. The Luach tab is a **working Jewish calendar, Jan 1900 – Dec 2100**, computed from real molad-and-dechiyos arithmetic (validated against known dates; fast-day postponements, leap Adars, and two-day Rosh Chodesh handled). Kiddush levana windows compute live. |
| `siddur.html` | Live siddur. Loads the table of contents and every text at runtime from the **Sefaria API** (Siddur Ashkenaz / Sefard / Edot HaMizrach), interlinear English where a translation exists, graceful Hebrew-only fallback where it doesn't, per-section license attribution, local caching. Checks the Supabase shared cache first, falls back to Sefaria directly. |
| `scripts/sync-siddur-cache.mjs` | Walks an entire nusach on Sefaria, prints a section-by-section **English coverage report**, and optionally populates the Supabase shared cache. Run it to get the real Sefard/Edot translation picture. |
| `supabase/migrations/0001_luach_app_initial_schema.sql` | The applied database schema (already live). |
| `manifest.webmanifest`, `sw.js`, `icons/`, `js/platform.js` | **PWA**: installable, offline-first, app shortcuts, install prompt, update toast. |
| `capacitor.config.json`, `package.json` | **Native iOS + Android** wrapper via Capacitor, with local notifications, keep-awake, geolocation. |
| `MOBILE.md` | Build/submission guide, and the Shabbos pre-scheduling rules that drive the notification design. |
| `js/zmanim.js` | **Live zmanim** from the free [Hebcal API](https://www.hebcal.com/home/195/jewish-calendar-rest-api) — no key needed. Prefetches 45 days and caches them, so Shabbos never depends on a live request. Includes a local NOAA solar fallback for a device that has never been online. |

## Supabase

Project: `https://qdofumucgrggpehrxvdr.supabase.co`

The schema is **purely additive** — this project already contained a Mishnayos
database (`sedarim`, `masechtos`, `perakim`, `mishnayos`) and campaign tables, and
none of them were modified. All app tables are namespaced `luach_*`:

- `luach_profiles` — nusach, zmanim shitos, location, candle offset, kiddush-levana minhag
- `luach_alarms` — time, ring duration (auto shut-off), scope (weekday / every Shabbos / Yom Tov block), per-day assignments
- `luach_minyanim` — shuls, tefillah times, reminder offsets
- `luach_notification_rules` — bespoke rules: any zman anchor ± offset, day filters
- `luach_yahrzeits` — Hebrew-date recurrence
- `luach_siddur_prefs` — nusach, display mode, bookmarks
- `luach_siddur_texts` — shared server-side cache of Sefaria sections (public read, service-role write)

Every table has RLS enabled; user tables are own-rows-only. The publishable key in
`siddur.html` is safe to ship client-side. The **service role key is not in this
repo and must never be** — it's only used locally/CI for the sync script via env var.

## Running

**Web / PWA** — static files, no build step. Serve over HTTPS and it's installable:

```bash
npm run serve          # http://localhost:5173
```

GitHub Pages works as-is. Installed, the mockup phone frame dissolves into a real
fullscreen app with safe-area insets.

**Native iOS / Android** — see `MOBILE.md`:

```bash
npm install
npm run add:ios && npm run ios          # macOS + Xcode
npm run add:android && npm run android  # Android Studio + JDK 17
```

The native wrapper exists for one non-negotiable reason: **Shabbos alarms must fire
with the app closed and untouched**, which needs OS-level pre-scheduled local
notifications, not web timers.

Coverage audit / cache sync:

```bash
node scripts/sync-siddur-cache.mjs "Siddur Sefard"          # report only
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
node scripts/sync-siddur-cache.mjs "Siddur Sefard"          # report + fill cache
```

## Text licensing

Texts and translations are served by the [Sefaria API](https://www.sefaria.org/developers).
Each rendered section displays its version titles and license fields from the API
response. Before shipping to an app store, filter ingested versions by license
(skip `Copyrighted`; honor attribution for CC-BY / CC-BY-SA; avoid CC-BY-NC if the
app is monetized). The Hebrew liturgy itself is public domain.

## Zmanim

Times come from Hebcal's free REST API (no key):

- `GET /zmanim?cfg=json&latitude=..&longitude=..&tzid=..&start=..&end=..` — a 45-day
  range in one request, written into `localStorage` and the service-worker cache.
- `GET /shabbat?cfg=json&..&M=on` — candle lighting, havdalah, and the parsha.

**Why prefetch rather than fetch on demand:** alarms and notification rules are
anchored to zmanim, and on Shabbos the app must not make a request or wait on one.
The app refreshes weekly over wifi and always has weeks of times on hand. The Today
screen labels its source — "Hebcal (cached)" or "computed on device" — so the user
knows what they're looking at. The local fallback is accurate to within a few minutes
and exists only so the app is never blank; **it is not a substitute for Hebcal's
times, and candle lighting should always come from the API**, where minutes matter.

Attribution: zmanim and candle-lighting data by [Hebcal](https://www.hebcal.com).

## Roadmap

- Per-shita configuration surfaced in Settings (Hebcal returns several tzeis/alos variants)
- Auth + syncing the mockup's settings/alarms/rules to the `luach_*` tables
- Smart Tachanun / Yaaleh V'yavo siddur logic driven by the calendar engine
- Open Siddur Project patches for Sefard/Edot translation gaps (per-section, license-tagged)
