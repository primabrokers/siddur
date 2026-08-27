export { ContactProfile } from './ContactProfile'
export { ContactSheet } from './ContactSheet'
export type { ContactSheetProps } from './ContactSheet'
export { ContactsList } from './ContactsList'
export { DetailsTab, RelationshipIntelligence } from './DetailsTab'
export { EngagementMeter } from './EngagementMeter'
export { GivingTab, PledgeCard } from './GivingTab'
export { MeetSheet } from './MeetSheet'
export { PinnedNoteBar } from './PinnedNoteBar'
export { ProfileActionBar } from './ProfileActionBar'
export { ProfileHeader, nextActionPhrase } from './ProfileHeader'
export type { GiftAidState, ProfileHeaderProps } from './ProfileHeader'
export { BeforeYouCall, CadencePanel, HouseholdPanel, OpenPledgePanel } from './RightRail'
export { TaskSheet } from './TaskSheet'
export { TimelineList, UpcomingBlock } from './TimelineList'

export {
  DEFAULT_DIALLING_CODE,
  DUPLICATE_REASON_LABEL,
  NAME_MATCH_THRESHOLD,
  displayName,
  fullName,
  nameSimilarity,
  normaliseEmail,
  normalisePhone,
  nullable,
  rankDuplicates,
  scoreDuplicate,
  waNumber,
} from './normalise'
export type { DuplicateMatch, DuplicateReason, DuplicateSignals } from './normalise'

export {
  CADENCE_PRESETS,
  DONOR_STATUS_LABEL,
  ENGAGEMENT_LABEL,
  ENGAGEMENT_SEGMENTS,
  cadenceLabel,
  languageLabel,
  compareByFlagThenName,
  mapContactStats,
  toDonorStatus,
  toEngagementTier,
  toFlag,
} from './stats'

export { TIMELINE_FILTERS, buildTimeline, filterTimeline } from './timeline'
export type { TimelineCategory, TimelineFeed, TimelineItem, TimelineKind, UpcomingItem } from './timeline'

export type * from './types'
