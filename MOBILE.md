# Mobile: PWA + native iOS / Android

The same HTML runs three ways — website, installed PWA, and native app — with
`js/platform.js` detecting which and adapting. The phone frame in `index.html` is a
mockup device only in a desktop browser; once installed it dissolves into a real
fullscreen screen with safe-area insets honoured.

## PWA (works today, no build step)

Files: `manifest.webmanifest`, `sw.js`, `icons/*`, `js/platform.js`.

- **Offline-first.** The shell is precached, so the app opens with no network at all.
  Sefaria/Supabase texts use stale-while-revalidate in a separate long-lived cache —
  a section read once stays readable forever.
- **Install prompt.** Android/desktop Chrome get a native install banner; iOS Safari
  gets a one-time "tap Share → Add to Home Screen" hint, since iOS never fires
  `beforeinstallprompt`.
- **Shortcuts.** Long-press the icon for Zmanim, Shabbos clock, Siddur, and Luach —
  wired to `#today`, `#clock`, `#cal` hash routes.
- **Update flow.** A new service worker shows a "Reload" toast rather than silently
  swapping mid-davening.

Serve over HTTPS (GitHub Pages is fine): `npm run serve` for local testing.

### PWA limits you must know
iOS web push/notification support is limited and only works when the site is
installed to the home screen, and background timers do not survive the app being
closed. **Therefore the PWA alone cannot be trusted for Shabbos alarms.** That's the
reason for the native wrapper below.

## Native build (Capacitor)

```bash
npm install
npm run add:ios        # needs macOS + Xcode
npm run add:android    # needs Android Studio + JDK 17
npm run ios            # sync + open Xcode
npm run android        # sync + open Android Studio
```

`webDir` is `.` so the existing static files ship as-is — no bundler.

### Plugins and why each is here
| Plugin | Purpose |
|---|---|
| `local-notifications` | **The critical one.** Pre-schedules every alarm and reminder so they fire with the app closed and untouched. |
| `keep-awake` | Shabbos clock keeps the screen on. |
| `geolocation` | Coordinates for zmanim; travel mode. |
| `status-bar`, `splash-screen`, `app` | Native chrome, Android back button. |
| `haptics` | Light tap feedback. |

## The Shabbos scheduling rule (design constraint, not a nicety)

Nothing may be scheduled, snoozed, or dismissed during Shabbos or Yom Tov. So:

1. **Schedule the whole block before candle lighting.** When Shabbos mode arms, the
   app computes every alarm for every day of the block (including day-by-day Yom Tov
   assignments) and queues them all via `Luach.scheduleAll()`.
2. **Alarms stop themselves.** Each carries `ringSeconds`; no dismiss UI is shown, and
   nothing waits for input.
3. **No interactive notifications during the block.** Reminder rules that would invite
   a tap (e.g. the mincha nudge) are suppressed and replaced by pre-set alarms.
4. **The app unlocks on its own** after havdalah — a queued notification, not a button.

Implementation note: on Android, exact alarms need
`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM` in `AndroidManifest.xml` plus
`allowWhileIdle` (already set) so Doze doesn't delay them. On iOS, request
notification permission during onboarding — **not** on erev Shabbos when it's too
late to matter. Keep queued notifications under iOS's 64-pending limit by scheduling
one block at a time and re-queueing after havdalah.

Ship custom alarm sounds as `ios/App/App/chime.wav` and
`android/app/src/main/res/raw/chime.wav`.

## Store submission notes

- **Permissions copy.** iOS `Info.plist` needs `NSLocationWhenInUseUsageDescription`
  ("Luach uses your location to calculate zmanim for where you are") — vague strings
  get rejected.
- **Both stores:** declare that notifications are local-only if you add no push
  service; complete the privacy questionnaire honestly (location used on-device for
  zmanim, no tracking, no ad IDs).
- **Attribution.** Keep the Sefaria credit and per-text licenses visible in-app;
  before shipping, filter ingested versions by license (skip `Copyrighted`, avoid
  `CC-BY-NC` if the app is monetized).
- **Android:** target the current API level, provide a 512×512 icon and feature
  graphic; adaptive icon uses `icons/maskable-512.png`.
- **iOS:** 1024×1024 marketing icon is at `icons/icon-1024.png`.
- Test on a real device across a Friday–Saturday to confirm alarms fire with the app
  force-closed. This is the one test that actually matters.
