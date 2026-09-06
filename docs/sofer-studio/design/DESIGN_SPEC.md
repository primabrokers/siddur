# Sofer Studio — Design Specification

**Version 1.0 · 2026-08-30 · Design lead: frontend (Kimi K3)**
Companion file: `reference-mockup.html` (open in any browser; everything below is demonstrated there).

---

## 0. Design thesis

Sofer Studio is a **workbench in a dark atelier**, not a web page. The sofer works at night, by lamplight, over glowing klaf. So the chrome of the application is a deep ink-charcoal bench, and the one luminous thing on screen is the parchment itself — the tikkun preview — which sits in the centre like a sheet under a lamp.

Three commitments, in priority order:

1. **Precision is the aesthetic.** Every number is in millimetres, always labelled, always in a tabular figure face. Nothing is rounded invisibly; derived values show the formula that produced them.
2. **The klaf is sacred ground.** Warm parchment lives *only* in the tikkun preview (and in saved-layout thumbnails). No other panel may use the parchment background — that exclusivity is what makes the preview feel like the real sheet.
3. **Restraint with one signature.** The bench is quiet, dense, and disciplined. The single memorable element is the **Sargel Rule** (§5).

> The mockup labels all content **SAMPLE**. Every estimate in production must be computed from the real calibration/geometry engine — the mockup shows structure and visual design only.

---

## 1. Colour tokens

Six named core tokens + three semantic tokens. All hex values are exact targets; the mockup implements them as CSS custom properties.

| Token | Hex | Role |
|---|---|---|
| `--klaf` | `#F2E7CE` | Warm parchment. **Tikkun preview and saved-layout thumbnails only.** |
| `--klaf-seam` | `#DFC99F` | Darker parchment: yeria seams, sheet edges, the deckle edge of the preview, hover tint on parchment rows. |
| `--dyo` | `#241E14` | Gall ink. All Hebrew text on klaf, line work on parchment (sirtut hairlines, letter strokes). |
| `--bench` | `#1A211E` | Workbench charcoal-green (lamp-black with a memory of gall). App background, all chrome base. |
| `--panel` | `#242F2B` | Raised panel surface on the bench: cards, tables, input wells. |
| `--teal` | `#3E8E81` | **Tevah teal** — every interactive and every *measurement* element: input focus borders, ruler ticks, links, selected states, progress accents. On parchment it darkens to `#2C6B60` for contrast. |
| `--shem` | `#C79A3F` | Shem gold. Highlight wash behind protected names (35% alpha on klaf), the left spine of the Shemos panel, "certain" classification. Never used for anything else. |
| `--madder` | `#B04A38` | Madder red. Validation errors, destructive actions, "below minimum nib" warning. |
| `--ok` | `#7FA653` | Validation pass / proofread-complete green (desaturated; the bench must never look like a traffic light). |

Derived values on the bench (computed, not new tokens):
- Bright teal for small interactive text on dark: `--teal-bright: #57B7A8` (4.6:1 at 14px).
- Text on bench: `rgba(242,231,206,.92)` primary, `.62` secondary, `.38` disabled.
- Hairlines on bench: `rgba(242,231,206,.14)`; on klaf: `rgba(36,30,20,.28)`.

**Contrast:** body text on bench ≈ 11.8:1. Shem gold is never used for small text — only fills, spines, and ≥12px bold labels.

**The risk I am taking:** a dark workbench around a luminous parchment centre, in a category where "the whole app is cream" is the default. Justification: the brief pins *parchment for the tikkun area* and *restrained ink/teal*. Making parchment exclusive to the preview turns a palette requirement into a spatial one — the eye always knows where the sheet is — and the teal reads as lamplight on a ruler rather than generic brand colour. Everything else stays conservative so the inversion carries no usability cost.

---

## 2. Typography

Three roles. The mockup is fully self-contained (no external fonts) and uses the fallback stacks; production should load the named faces (both OFL, on Google Fonts).

| Role | Production face | Mockup fallback stack | Used for |
|---|---|---|---|
| **Hebrew text (Ktav role)** | **Frank Ruhl Libre** (400/700) — a Hebrew serif with real scribal ancestry | `"Frank Ruhl Libre","David Libre","SBL Hebrew","Ezra SIL","Noto Serif Hebrew",serif` | All Torah text in the tikkun, Shem tokens, verse chips. Set with `lang="he"`, `dir="rtl"`. |
| **Latin display / UI voice** | **Fraunces** (opsz, weight 400–600, never above 600 — dignity, not shout) | `Iowan Old Style,Palatino Linotype,Palatino,Georgia,serif` | Wordmark, panel titles, section numbers, empty states. Small-caps + letterspacing for eyebrows. |
| **Measure / data** | system tabular mono | `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace` with `font-variant-numeric: tabular-nums` | **Every** mm value, table cells, derived results, validation deltas, ruler ticks. A measurement is never set in a proportional face. |

### Type scale (1.25 ratio, base 15px desktop / 16px phone)

| Step | px | Use |
|---|---|---|
| `t--2` | 12 | Table captions, units ("mm"), overline labels |
| `t--1` | 13 | Dense table body, secondary text |
| `t-0` | 15 | UI body |
| `t-1` | 19 | Panel titles (Fraunces 560) |
| `t-2` | 24 | Sheet-level headings, comparison totals |
| `t-3` | 30 | The one big number (total klaf metres) |
| Hebrew body | 17–18px | Tikkun lines: render ≈1.15× Latin body for equivalent legibility |

Eyebrow labels: `t--2`, Fraunces small-caps, `letter-spacing:.14em`, teal. Units: after every numeric input and result, a `t--2` `mm` (or `m` for klaf length) in secondary colour — units are part of the value, never implied.

---

## 3. Layout grid

### Desktop (≥1280px) — the workbench

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ▓ APP BAR: wordmark · profile switcher · layout lock state · save · search ▓ │ 48px
├── SARGEL RULE (signature: live mm ruler, spans full width) ──────────────────┤ 28px
│ ┌─ LEFT RAIL ─────────┐ ┌─ TIKKUN (parchment) ───────────┐ ┌─ RIGHT RAIL ────┐│
│ │ 01 Calibration      │ │  sargel ruler strip (top)      │ │ 04 Shemos       ││
│ │    letter table     │ │  ┌──────────────────────────┐  │ │ 05 Passages &   ││
│ │ 02 Column geometry  │ │  │ K L A F                  │  │ │    unusual      ││
│ │    inputs + derived │ │  │  RTL Hebrew columns,     │  │ │    letters      ││
│ │    results table    │ │  │  sirtut hairlines,       │  │ │ 06 Validation   ││
│ │ 10 Search           │ │  │  Shem gold wash,         │  │ │    results      ││
│ │ 11 Compare (mini)   │ │  │  column seam markers     │  │ │                 ││
│ └─────────────────────┘ └────────────────────────────────┘ └─────────────────┘│
├── LOWER BENCH (collapsible drawer, 240px default) ───────────────────────────┤
│  tabs: 07 Saved layouts · 08 Progress · 09 Diff · 11 Compare (full)          │
└──────────────────────────────────────────────────────────────────────────────┘
```

- Left rail **320px**, right rail **360px**, centre fluid (min 480px). Gutter 12px, shell padding 12px.
- Panels are cards on `--panel`: 1px hairline, 10px radius, 14px padding, collapsible (chevron), collapse state remembered.
- Lower bench is a drawer; collapsed to a 36px tab strip by default, expands on click or the backtick key.

### Narrow (<1024px) — stacked, tabbed

```
┌──────────────────────────┐
│ app bar (48px)           │
│ sargel rule (28px)       │
├──────────────────────────┤
│ TAB BAR: Klaf·Measure·   │ 44px, sticky
│ Shemos·Checks·Bench      │
├──────────────────────────┤
│  active panel full-width │
│  tikkun keeps parchment  │
│  + h-scroll (the sheet   │
│  never squishes)         │
└──────────────────────────┘
```

The tikkun scrolls horizontally on phone — column width is a *physical* value; it must never be responsive-compressed. All touch targets ≥44×44px.

### Breakpoints

| Name | Range | Behaviour |
|---|---|---|
| `phone` | <1024px | Stacked + tab bar; rails become tabs; drawer becomes "Bench" tab; h-scroll tikkun |
| `bench` | 1024–1439px | Full 3-column; right rail may collapse to a 48px icon strip |
| `wide` | ≥1440px | Rails at max width (340/380); tikkun shows 2 amudim side by side; comparison moves inline |

---

## 4. Shared component language

- **Panel header:** eyebrow (`§number · EN NAME`) + Hebrew name in Frank Ruhl (e.g. `כיול · אותיות`), sirtut hairline below, chevron at left. Section numbers (01–11) match this spec and the requirement list — numbering encodes the spec, not decoration.
- **Sirtut divider:** the bench hairline is a *scored* line: 1px `rgba(klaf,.14)` with a 1px darker groove beneath — the ruled-line motif of the sirtut, the bench's only ornamental device.
- **mm input:** mono value + `mm` suffix, 44px tall, panel well, 1px `rgba(klaf,.18)` border; focus → teal border + 2px teal outer ring + the Sargel Rule wakes on that dimension. Steppers step 0.1mm (Shift = 1mm). Invalid input: madder border + inline message; the value is never silently coerced.
- **Derived value:** `t--1` secondary label, `t-1` mono klaf value, formula in `t--2` mono beneath (`42 × 8.00 = 336.0 mm`). Derived values are read-only and marked with a `ƒ` glyph.
- **Status chips:** pill, 10px radius, `t--2` caps. written = teal outline; checked = teal fill; proofread = `--ok` fill; locked = klaf fill + padlock glyph; error = madder.
- **Buttons:** primary = teal fill, dyo text; ghost = 1px klaf hairline; destructive = madder ghost, madder fill on confirm. Buttons state the action ("Adopt candidate layout", never "OK").

---

## 5. Signature element — **The Sargel Rule** (סרגל)

A 28px **live millimetre ruler** spanning the full app width under the app bar, styled as an engraved brass-in-teal measuring rule. It is the bench's identity: the sofer's sargel made digital.

Behaviour:
1. **At rest** it shows a quiet cm scale with mm minor ticks (teal at 40% on bench).
2. **When any mm input is focused or hovered**, the rule wakes: ticks brighten to full teal, and a **calibrated window** highlights the physical magnitude of that value (focusing "line width 130mm" highlights a 130-unit span from zero), with the value flag pinned above it in mono.
3. **In the tikkun**, a matching vertical rule runs down the left edge of the sheet; hovering a line lights the sirtut line *and* its tick on the rule, tying screen position to physical mm.
4. Units toggle ships disabled with the tooltip "Sofrim measure in mm" — a small joke with a straight face; keep it or cut it.
5. Pure CSS/SVG; `prefers-reduced-motion` → no wake animation, the window appears instantly.

This is the one flourish. Everything around it stays quiet so it stays special.

---

## 6. Component specs — the 11 areas

Every area below is present and interactive in `reference-mockup.html`. Hebrew labels are part of the spec.

### 01 · Calibration / Letter Table — כיול אותיות
- **Controls row:** master letter height (mm, with "scaled from 6.00mm reference"), kav/stroke thickness (mm), min practical nib (mm, user-set). If stroke < min nib → the stroke input gets the madder treatment + a persistent warning banner in this panel *and* the app bar: "Kav 0.26mm is below your 0.30mm minimum nib — widths will lie on parchment."
- **Table** (dense, mono numerals, sticky header): Letter (Frank Ruhl, 20px) · Skeleton mm · +Stroke mm · **Total mm** · Stretch cap (×) · Stretchable (✓/—). Restricted letters (י ו ז ן נ ג צ ץ default) show an ink-dash in Stretchable and their cap cell is struck through. Row hover → the letter renders large at the row's end on a parchment chip.
- Footer contract note, always visible: "Skeleton widths **exclude** stroke; stroke is added once here and never again."
- Override: clicking a cap cell opens an inline stepper (per-letter max stretch, hard-capped at 1.8×).

### 02 · Column Geometry — מידות העמוד
- Input grid (2-col): sirtut pitch (rovach) mm, top margin, bottom margin, column gap, outer margin, line width mm.
- **Derived results block** (ƒ-marked, formula under each): lines per column (42), column height, amud height/width, amudim per yeria, total amudim, total yerios (with partial-final-yeria note: "last yeria carries 2 of 3 amudim"), and **total klaf length in metres — the one `t-3` big number on the bench**, teal mono.
- Min-column-width guard, live under the line-width input: `3 × למשפחותיכם = 118.4mm ≤ 130mm ✓` (or madder ✗ with the exact shortfall). The phrase is set in Frank Ruhl at calibrated relative width.

### 03 · Tikkun Preview — תקן הסופר
The centrepiece, parchment-only zone.
- Sheet: `--klaf` card, `klaf-seam` 6px deckle on the yeria-seam side, soft inner vignette (8% dyo) like lamplight.
- **Sirtut:** faint scored hairlines at the configured pitch behind every line; text sits on them.
- Hebrew RTL columns in Frank Ruhl. Line numbers (Hebrew gimatria numerals, `t--2`, 40% dyo) in the outer margin. Amud number centred at top.
- **Shem tokens:** `--shem` at 35% alpha wash, 2px radius, 1px gold underline; hover tooltip "Shem · יהוה · whole token kept on one line".
- **Unusual letters:** teal caret ring + margin glyph (enlarged ב of בראשית rendered 1.6×; dotted words carry CSS dot marks; the inverted nuns render as a bordered inline-block nun pair with a pattern chip "ונוסעה · bracket scheme (SAMPLE source)").
- Column break: a `klaf-seam` vertical seam with stitching dashes between amudim; a yeria seam is a stitched double-line.
- Line hover → crosshair to the Sargel Rule. Clicking a line selects it: teal left-edge flag + the ref appears in the app bar ("Amud 1 · line 7 · ברא׳ א:ד").
- Sample content: Bereishis 1:1–10, watermarked "SAMPLE TEXT" diagonally at 6% alpha.
- Taggin toggle (panel 05) draws three small strokes over שעטנ״ז ג״ץ letters — display only; its tooltip states "Display only — does not change measurements."

### 04 · Protected Names (Shemos) — שמות הקודש
- List grouped Certain / Needs review. Row: whole token (Frank Ruhl; gold spine certain, madder-dashed spine uncertain), position (`Amud 3 · line 12`), classification chip, "show on sheet" button that scrolls to and flashes the token in the tikkun.
- Uncertain rows carry review copy: "Pattern match only — the sofer decides." plus Approve / Dismiss ghost buttons.
- Tokens wider than the column appear in a red "**Unsatisfiable**" sub-section with the overflow in mm: `token 138.2mm > line 130.0mm — cannot be split or truncated.`

### 05 · Unusual Letters & Passage Schemes — אותיות מוזרות ופרשיות
- **Passage cards:** Shiras HaYam (brick-over-brick pattern, scheme dropdown "Ariach al gabei leveinah — SAMPLE"), Ha'azinu (two-column 70-line scheme), Vayehi Binso'a (inverted nuns, dropdown with source+version line: "Scheme: R. Shabtai Sofer bracket · v1 · SAMPLE"). Each card: enable toggle, scheme select, mini SVG of the pattern shape. Missing verified data → explicit blocker chip "Source data missing — normal wrapping NOT applied."
- **Unusual letter occurrences table:** kind chips (large/small/dotted/broken/suspended), position, letter, per-occurrence width-override stepper (mm, marked "override" when set), reset button.
- **Taggin toggle** at panel foot (see 03).

### 06 · Validation Panel — בדיקות
- Summary strip: counts by severity (`2 errors · 3 warnings · 41 lines clean`).
- Table: Line ref · Check · Result (mono delta, e.g. `+1.8mm over`) · severity glyph. Check names in plain language: Overfull, Underfull, Conflicting bounds, Shem too wide, Min column width (3× למשפחותיכם), Letter count > max. Row click jumps the tikkun to the line and pulses it once (no pulse under reduced motion).
- Hard errors use a madder row tint; sorted errors-first, then by position.

### 07 · Saved Layouts — גרסאות שמורות
- Card list. Each card: klaf thumbnail strip (the only other place klaf appears), name, created date, status chip (Draft / **Locked** / Candidate), snapshot summary in `t--2` mono: `source rev a3f9 · profile Ari-4.0 · geom 42×8.0 · patterns v1 · 2 overrides`. Locked cards show the padlock spine and "writing began 2026-08-12".
- Actions: Open, Duplicate as candidate, Compare. Locked cards are immutable — "Duplicate as candidate" is the only mutation path.

### 08 · Progress Tracking — התקדמות
- Amud grid: numbered cells (1–245 in sample), tri-state: written = teal outline, checked = teal fill, proofread = `--ok` fill. Tooltip: `Amud 17 · 42 lines · checked 30/42`.
- Aggregation bar: `Lines: written 61% · checked 44% · proofread 22%` with a triple-segment stacked bar (in that order — the order encodes the workflow).
- Line detail: selecting an amud shows its 42-line strip with per-line status dots; clicking a dot cycles status (confirm when regressing from proofread).
- Lock notice: "Progress identity is stable — calibration changes create candidates, they never touch written lines."

### 09 · Diff View — השוואת מועמד
- Header chips: `LOCKED 2026-08-12` vs `CANDIDATE (kav 0.35 → 0.30mm)`.
- Line diff list: ref · verse chip · change type (moved / re-broken / unchanged). Moved lines: `Amud 3 L12 → Amud 3 L14` in mono with madder→teal arrows. Verse-level rollups collapse unchanged runs.
- Footer: **Adopt candidate** (primary, disabled until "21 unchanged written lines verified" is ticked), Discard candidate (ghost), Export diff (ghost).

### 10 · Search — חיפוש
- App-bar field (mirrored in left rail): accepts `בראשית א:ד`, `Gen 1:4`, or free text. Result card: verse (Frank Ruhl RTL), `Amud 1 · lines 4–5` (spans shown as ranges), "Jump" button → scrolls tikkun, selects the lines.
- Empty state: "No verse matches — try chapter:verse like ג:יב." Errors are plain and actionable.

### 11 · Side-by-side Comparison — השוואת פרופילים
- Lower-bench tab (full) + mini cards (left rail). 2–3 profile columns, same source + same geometry, stated in a hairline header: `Source rev a3f9 · Geometry 42×8.0mm · 130mm line`.
- Each column: profile name, letter height, then the totals stack in mono: total amudim · yerios · **klaf metres** (`t-2`). A delta row shows ± vs the leftmost profile. Header must state: "Each column is an independent full layout, not a rescale."

---

## 7. Interaction states & motion

- **Focus:** 2px `--teal-bright` ring + 2px offset on every interactive element; never mouse-suppressed.
- **Hover:** bench cards gain a 1px teal hairline; parchment rows tint to `klaf-seam` 40%.
- **Motion budget:** panel collapse 160ms ease-out; Sargel wake 240ms; line pulse 600ms once. `prefers-reduced-motion`: instant state changes; the tikkun pulse becomes a persistent flag until dismissed.
- **Loading:** skeletons are ruled sirtut lines, not grey blobs — even waiting looks like the craft.

---

## 8. RTL & Hebrew handling

- The **app shell is LTR** (tooling language); the tikkun, verse chips, Shem tokens and the min-width guard phrase are `dir="rtl" lang="he"` islands. Never rely on bidi auto-detection for mixed mm+Hebrew strings — wrap Hebrew tokens in `<bdi>` inside Latin sentences (e.g. `3 × <bdi>למשפחותיכם</bdi> = 118.4mm`).
- Tikkun line numbers use Hebrew letters (א׳ ב׳ ג׳…). Inputs accept Arabic numerals only.
- Combining marks (niqqud/taamim) must never be split from base letters in wrapping, truncation, or count display — UI must use grapheme segmentation (`Intl.Segmenter`) for any client-side counting.

---

## 9. Accessibility

- Full keyboard map: `Tab` through panels; `1–9,0,-,=` jump to the 11 panels; arrows move within the letter table (roving tabindex); backtick toggles the lower bench; `/` focuses search; `Esc` returns focus to the tikkun.
- The tikkun is a `role="document"` region labelled "Tikkun preview, sample text"; lines are list items with `aria-label` "Amud 1, line 7, Genesis 1:4".
- Status is never colour-only: chips carry text; progress cells carry `aria-valuetext`; validation severities carry glyphs (▲ error, ● warning, ✓ clean).
- 44×44px minimum targets on phone; steppers are 44px wide.
- All Hebrew sample text has `lang="he"`; screen-reader-only Latin transliteration labels are provided on tokens.

---

## 10. Sample data disclaimer (mockup contract)

Every panel in the mockup carries a `SAMPLE` ribbon or caption. Production rule, restated from the implementation brief: demo excerpts must be labelled excerpts, counts must never be presented as full-Torah totals, and every displayed estimate must come from the real engine.

---

*End of spec. Build order suggestion: tokens → app shell + Sargel Rule → tikkun → rails → lower bench → phone tabs.*
