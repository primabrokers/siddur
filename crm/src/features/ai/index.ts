/**
 * M9a — the AI surfaces (09 §3–§5).
 *
 * Everything exported here obeys the 09 §1 contract without exception:
 * propose → preview → confirm → write, one label with two states, every run
 * logged, and a manual path that works when none of it is available.
 */

export { AiLabel, WhyLine } from './AiLabel'
export type { AiLabelProps } from './AiLabel'

export { BriefPanel } from './BriefPanel'
export type { BriefPanelProps } from './BriefPanel'

export { HoldingLine } from './HoldingLine'
export type { HoldingLineProps } from './HoldingLine'

export { DraftSheet } from './DraftSheet'
export type { DraftSheetProps } from './DraftSheet'

export {
  BEREAVEMENT_MARKERS,
  BRIEF_BULLET_ORDER,
  DRAFT_PURPOSES,
  ILLNESS_MARKERS,
  OVERDUE_TOP,
  PURPOSE_LABEL,
  THIN_FILE_INTERACTIONS,
  TIMELINE_LIMIT,
  actionTypeLabel,
  buildBriefFacts,
  composeDigest,
  detectExclusion,
  digestSubject,
  digestText,
  isExcluded,
  labelText,
  nextLabel,
  resolutionFor,
} from './core'
export type {
  AiLabelEvent,
  AiLabelState,
  AiResolution,
  BriefBullets,
  BriefFacts,
  BriefInput,
  BriefResponse,
  DigestInput,
  DigestPayload,
  DigestTask,
  DraftFact,
  DraftPurpose,
  DraftResult,
  ExclusionResult,
} from './core'
