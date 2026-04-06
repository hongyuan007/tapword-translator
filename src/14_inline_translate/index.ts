// Services
export { tryAutoTranslate } from "./services/InlineTranslationService"
export type { AutoTriggerParams } from "./services/InlineTranslationService"

// Utils
export { extractBlockText } from "./utils/blockTextExtractor"
export type { TextNodeSegment, BlockTextResult } from "./utils/blockTextExtractor"
export { mapCandidateToRange } from "./utils/candidateDomMapper"
