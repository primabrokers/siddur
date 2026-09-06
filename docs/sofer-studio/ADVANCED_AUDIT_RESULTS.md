Controller just executed `node docs/sofer-studio/audit-advanced.mjs` through real HTTP, isolated temporary SQLite; cleanup completed, preview untouched. Five additional material failures verified (current correction still WIP):

1. Aggregate stretch allowed to overfill: 8.5mm base in a10mm line, two1mm expansions each under1.5mm per-letter cap =>HTTP200,leftover-0.5mm. Must reject atomically.
2. Saved draft after live profile height3→4mm: empty replacement stretch returns width10.5mm instead of frozen8.5mm. Must use saved snapshot/line.
3. Locked rerun with same words but changed physical measurements produces diff[]; must display measurement changes.
4. Adopt changed measured line with client verified_unchanged_lines sends oldlineID =>HTTP200,statuswritten. Server must independently verify unchanged geometry/content before carrying progress.
5. Adopted layout summary{} loses totals; preserve candidate computation/snapshots rather than recomputing from later live profiles.

This file supplements FINAL_REVIEW_PRIORITIES.md. Please include in immediate Opus5 review and DeepSeek repairs. No product files changed by controller.
