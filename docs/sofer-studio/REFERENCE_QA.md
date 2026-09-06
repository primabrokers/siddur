# Kimi reference QA for implementation

Observed in the recovered reference HTML at desktop size using the in-app browser. This is design-reference QA, not a production-app verdict.

- The reference renders its dark workbench and parchment preview successfully, but startup logs TypeError: Cannot set properties of null (setting 'textContent') in updateGuard at line748. Fix the missing/mismatched element wiring in the production implementation; do not copy the mockup's JS blindly.
- At the tested 1250px-wide viewport, calibration fields run horizontally outside their narrow sidebar. Make the settings grid shrink correctly and use appropriate breakpoints, not clipped controls.
- The reference compares kav thickness to 'minimum practical nib'. The current requirement is a configurable minimum practical LETTER HEIGHT warning. Separate these concepts if additionally offering minimum stroke width; don't warn against the wrong measurement.
- The reference shows only22 letter rows. The real table must include all27 Hebrew letters including five sofiyot, editable unit widths and mm equivalents.
- The reference labels42 lines as fixed. Production must allow42/48/60/custom as requested and calculate all totals from actual data.
- Sample totals, invented positions, reference annotations and locked sample state are design placeholders only. Production must derive all displayed values from saved source/profile/layout data.

Keep Kimi's visual direction; fix these functional issues during DeepSeek's frontend implementation. Do not spend a separate cycle regenerating the reference mockup.
