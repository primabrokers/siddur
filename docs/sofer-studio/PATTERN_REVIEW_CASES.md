Current correction-wave pattern implementation needs independent regression checks before accepting it:
- renderPattern checks queue.length INSIDE each slot loop: a valid two-line/two-slot pattern with one source word per slot will reject after slot1. Coverage check belongs after all slots.
- queue.findIndex permits reordering: source [אב,גד] and pattern tokens[גד,אב] can consume both and pass. Preserve exact source reading order, not merely a multiset match.
- Explicit segment gaps are added to width but are not retained as positioned items/segments for rendering; first-segment gap is ignored, ordinary word gap may be added on top of explicit gaps, and occurrence overrides are discarded in fixed rendering. Verify numeric geometry AND rendered positions/annotations/Shem identity after persistence.
- Absence of selected pattern must still block known special passages from ordinary wrapping/writing-ready export; see CORRECTION_ACCEPTANCE_CLARIFICATION.md.

Use tiny two-slot source fixtures and a repeated-word passage for regression. These are observations on work in progress, not a final claim the child won't repair them itself.

Opus review must also cover ORIGINAL requirements, not only our defect list: editable minimum/maximum spacing limits and setuma reference, actual phone workflow, built-in full study-text import, unusual occurrence editing, taggin display, and truthful print/PDF/JSON/CSV exports. A button or helper function alone doesn't satisfy a working feature.
