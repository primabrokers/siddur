# Sofer Studio regression audit — 7 September 2026

The v10 update removed working features outside the requested STAM changes. v11 retained those removals. This repair restores the earlier behaviour while retaining the requested controls, font and import fixes. It also corrects the row-unit interpretation explicitly clarified on 7 September.

## Evidence and scope

Compared the running v9, v10 and v11 container sources with the original `6152ac6` baseline and canonical main `c1091c9`. Checked the original user requests for STAM markers, human-selected holy letters, stretch preferences, line-edge lamed, automatic stretching and Hebrew import/font repair. Runtime databases and credentials were excluded from the source comparison and release archive.

The v9-to-v10 source change touched 32 files; the v10-to-v11 change touched seven. Much of the v10 browser code had reverted to the original baseline, removing intervening work. Restoration used a three-way comparison against that baseline, then resolved the STAM additions explicitly. Four regression tests fail against the actual v11 browser sources and pass against the repair.

## Findings and disposition

| Area | Regression found | Repair |
| --- | --- | --- |
| Visible stretching | Letter boxes widened but the actual glyphs did not stretch. | Restore measured inner glyphs, font-ready fitting and visible horizontal scaling. Retain holy-letter markings and lamed edge overhang. |
| Units | `average_letter` normalised the mean of all 27 letter widths to one row unit, allowing far more than 31 two-unit letters in a 62-unit row. | New `line_units` mode uses each table width directly. Existing average-mode profiles use corrected units when computing a new draft; stored inputs and previous layouts are not rewritten. |
| Calibration | Unit controls and live calculation disappeared. Opening profiles could replace saved modes, stroke factors and stretch policy. | Restore the controls and live table, preserve manual profiles and earlier stretch policies, protect unsaved edits and discard stale profile loads. |
| Stretch review | Whole-book preview/apply, applied report, CSV and fit-to-margin review copy were inaccessible. | Restore their controls and existing API calls. Preserve written lines and existing stretch decisions. |
| Preview/workspace | Paging, fit controls, focus mode, workflow navigation and complete printing disappeared. | Restore lazy page rendering, preview controls, Setup/Layout/Review/Download and all-page printing. |
| Paragraph spacing | The new 20-unit minimum changed old profile geometry. A book-ending petuchah could be lost during reference reflow. | Apply the new minimum only to v2 rules; preserve both petuchah and book-end metadata. |
| Preferences and marks | Numeric preferences sorted as strings; large/small letter caps used an unmarked width. | Sort numerically and calculate caps from actual marked width. |
| Fixed passages | New whole-song-page protection also changed older policies; fallback song gaps were calculated against a shrinking remainder. | Scope whole-page protection to v2 and compute equal fallback gaps once. |
| Test coverage | The runner listed only selected test files, omitting regression suites. | Discover and run every `*.test.js`; restore the browser component suites and add specific regression cases. |

Requested changes retained: exact human-marked holy letters without inferred classification; p/s/l and song controls; large, small, dotted and inverted-nun marks; special-width table; numeric stretch preferences; 2/3/1 default letter widths; automatic first-compute stretch; STAM Ashkenaz font; strict UTF-8 and BOM-marked UTF-16 import; the corrected `layout_id` response handling. The corresponding engine, import and API suites remain enabled and pass.

## Correct unit calculation

For a column width `W` and row budget `N`, one row unit is `W / N` mm. A table width of two uses `2 × W / N`; a width of three uses `3 × W / N`. Vertical letter height cannot silently rescale that row budget. The existing physical stroke contribution is added once; inter-letter gaps, word spaces and explicit marker widths also consume the available width.

At 62 units, before those additional allowances:

- 31 two-unit letters occupy 62 units.
- 20 three-unit letters occupy 60 units; the 21st cannot fit.
- 13 two-unit letters plus 12 three-unit letters occupy exactly 62 units.
- With two-unit word spaces, 16 separate two-unit letters plus 15 spaces occupy 62 units.

Words remain indivisible. An individual word wider than the column is reported as overfull rather than truncated. Fixed reference/song lines retain their required membership and can still require measurement review. The legacy manual/reference-height skeleton modes remain available for existing calibrations.

## Validation

- All 27 test files passed: **228 checks**, including engine, HTTP/SQLite, exports, import, snapshot isolation, reference reflow and browser components.
- Exact unit-budget checks cover two-unit, three-unit and mixed letters; height and column changes; unused letter-table entries; stroke, gaps, word spaces; large/small marks; indivisible words; old average profiles and saved-layout isolation.
- Full reference checks retain letter order, section markers, fixed passages and all five book boundaries. Genesis reflows to 77 columns at 50 row units and 49 at 80, preserving all 78,063 letters.
- Real Chromium comparison: v11 had zero measured inner glyphs and average visible-width error 4.276 px. The repaired preview's average error was below 0.00005 px across the sampled stretched letters. Paging, applied report, CSV availability, holy marks and mobile rendering passed with no browser JavaScript errors.
- The same synthetic passage changed from 86 lines / 3 columns under the incorrect average model to 184 lines / 5 columns with actual row units. This is the expected correction, not lost text.
- Source whitespace check passed. No database migration or reference-text replacement is included.

## Release and saved work

Release files under `sofer-studio/deploy` create separate saved and temporary v12 services, use an online SQLite backup, and validate a scope-locked change to the Sofer route. Other sites' configuration bytes are checked for preservation. Old temporary sessions remain on their existing service until the user explicitly selects `?upgrade=regression-v12` or the session expires; this prevents loss of their in-memory work.

Saved layouts retain their original snapshots and decisions. Compute a new draft to use corrected row units. Existing stored profiles are not bulk migrated, and no old database is restored over current work.

Release verified live at `https://sofer.primainsurance.tech/?upgrade=regression-v12`. Both v12 services are healthy and run image `sha256:08a35301838d8ddac820d3f36d56f8665ff76e6e16bc3a0308762405d625b69c`; all 49 engine/server/public files match the tested source byte-for-byte. Public-route Chromium checks repeated the stretching, paging and report checks and confirmed line-letter counts `[31,31,2]` for 64 two-unit letters, `[20,20,5]` for 45 three-unit letters, and 25 letters on the first mixed row. No browser JavaScript errors occurred.

The online SQLite backup passed its integrity check. All eight saved-workspace tables have identical row counts and content fingerprints before and after deployment, including all 21 layouts and 171,874 stored lines. The shared router's non-Sofer bytes were unchanged. Previous production containers were retained without restart; disposable audit containers were removed after verification.
