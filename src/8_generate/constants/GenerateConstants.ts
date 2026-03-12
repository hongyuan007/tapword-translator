/**
 * Constants for 8_generate module
 */

/**
 * Default LLM generation parameters
 */
export const DEFAULT_TEMPERATURE = 0.35
export const DEFAULT_MAX_TOKENS = 1200
export const DEFAULT_TIMEOUT = 10000 // 10 seconds

/**
 * Prompt task names
 */
export const TASK_WORD_TRANSLATION = "word_translation"
export const TASK_FRAGMENT_TRANSLATION = "fragment_translation"
export const TASK_FRAGMENT_ONLY_TRANSLATION = "fragment_translation_only"
export const TASK_AUTO_CANDIDATES = "auto_candidates"

/**
 * Prompt file names
 */
export const PROMPT_FILE_SYSTEM = "system_prompt.txt"
export const PROMPT_FILE_USER_TEMPLATE = "user_prompt_template.txt"
export const PROMPT_FILE_FEWSHOT = "fewshot.json"

/**
 * Default language for fallback
 */
export const DEFAULT_FEWSHOT_LANGUAGE = "en"
