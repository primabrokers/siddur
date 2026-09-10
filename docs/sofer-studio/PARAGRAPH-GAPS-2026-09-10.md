# Paragraph gaps and brighter display - 10 September 2026

New calculations using the current measurement policy reserve at least 20 row units after a petuchah's preceding word. If that word plus its gap cannot fit, the whole word moves to the following line with the paragraph ending. Larger configured gaps remain effective. Setumah fitting also keeps its preceding word, minimum gap and following word together. An indivisible word that cannot fit alongside its required gap is retained and reported as invalid.

Both synchronous and asynchronous fitting use the rule, including measured reference reflow. Prose paragraph endings immediately beside a song can wrap independently; fixed song and inverted-nun text remains intact. Exact reference mode and historical millimetre policies retain their existing membership rules. Saved layout snapshots are unchanged; compute a new draft for corrected fitting.

The Stroke (kav), Min stroke width and inter-letter spacing inputs are removed. New profiles have zero additional stroke allowance, zero inter-letter gap, and a default word space of 1 unit. Existing saved calibration values are retained when profiles are opened and saved. Letter height remains the single height control, in units, defaulting to 2. The four special rows retain the same percentage/Unlimited choices as letters.

The workbench now uses white panels, a light sage background and dark text, including navigation, preview tools, import cards and the line editor. The measured parchment preview, font, physical letter dimensions and print layout are preserved.

## Verification

- All 30 test files / 241 checks passed in the release image. Coverage includes 62-unit budgets, mixed letter widths, explicit stretch limits, human-marked holy letters, saved profiles, imports, printing and navigation.
- Added exact-boundary and insufficient-space paragraph cases, larger minimum gaps, setumah adjacency, impossible whole words, and synchronous/asynchronous parity.
- Full five-book reference reflow preserved every letter occurrence, every petuchah anchor, fixed passage text and all five book endings. Every ordinary petuchah ending retained at least the required gap; no setumah was orphaned at a line edge.
- Real Chromium on the public site saved and reloaded all four special-row cap controls, verified default height 2 / word space 1 / zero extra stroke, and computed 3 height units as 6 mm in a 124 mm / 62-unit column. Actual interior glyph stretching matched its measured box.
- Public paragraph canaries moved the preceding word correctly. Measured browser whitespace was 60.00 and 30.00 row units, both above the 20-unit minimum. Desktop and mobile displays were checked; no JavaScript errors occurred.

## Release and preservation

Release `paragraphs-v14` is live in separate healthy saved and temporary services, on image `sha256:b0c9f4eeac97082057f2a5fea93568007139cc62b752ca243526872d707b779c`. All 51 engine/server/public/database-code files in both services match the verified source.

The online backup at `/opt/sofer-studio/backups/paragraphs-v14-20260910/sofer-before-v14.sqlite` passed SQLite integrity checks. Ordered row hashes across every saved table matched before and after startup: 7 profiles, 16 sources, 8 geometries, 21 layouts and 171,874 layout lines remain unchanged. There is no database migration in this release.

Only the Sofer routing block changed. Other host routing bytes are unchanged, and older temporary services remain available without restarting their sessions. The saved workspace uses the new release. The link `https://sofer.primainsurance.tech/?upgrade=paragraphs-v14` selects the updated temporary version; export temporary work before switching versions.
