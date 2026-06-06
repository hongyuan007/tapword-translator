/**
 * Auto-Candidates Generation Service
 *
 * Generates auto-translation candidates using a local LLM, following the same
 * pattern as WordTranslationService / FragmentTranslationService.
 * Includes a full post-processing pipeline that mirrors the cloud backend.
 */

import * as loggerModule from "@/0_common/utils/logger"
import type { AutoCandidate, AutoCandidatesRequestData, AutoCandidatesResponseData } from "@/0_common/types"
import type { LLMConfig, ChatMessage } from "../types/GenerateTypes"
import * as promptLoaderModule from "../utils/promptLoader"
import * as templateRendererModule from "../utils/templateRenderer"
import * as constants from "../constants/GenerateConstants"
import { OpenAICompatibleClient } from "./llm/OpenAICompatibleClient"

const logger = loggerModule.createLogger("AutoCandidatesGenerationService")

// ============================================================================
// Level-Based Dynamic Limit Configuration
// Adjust these values to control auto-candidate density per proficiency level.
// ratio: proportion of words in blockText to translate (0.0 – 1.0)
// min/max: floor and ceiling for the computed limit
//         (max is a safety guard against token waste on abnormally long texts)
// ============================================================================
interface LevelLimitConfig {
    ratio: number
    min: number
    max: number
}

const LEVEL_LIMIT_CONFIG: Record<string, LevelLimitConfig> = {
    Beginner:     { ratio: 0.40, min: 5, max: 50 },
    Intermediate: { ratio: 0.25, min: 3, max: 30 },
    Advanced:     { ratio: 0.10, min: 1, max: 15 },
}
const DEFAULT_LEVEL_CONFIG: LevelLimitConfig = LEVEL_LIMIT_CONFIG.Intermediate!

/** Compute dynamic limit based on block text word count and user proficiency level */
function computeEffectiveLimit(blockText: string, userLevel: string): number {
    const config = LEVEL_LIMIT_CONFIG[userLevel] ?? DEFAULT_LEVEL_CONFIG
    const wordCount = blockText.split(/\s+/).filter((w) => w.length > 0).length
    const rawCount = Math.floor(wordCount * config.ratio)
    return Math.max(config.min, Math.min(rawCount, config.max))
}

// Level-specific fewshot file mapping
const LEVEL_TO_FEWSHOT_FILE: Record<string, string> = {
    Beginner: "fewshot_beginner.json",
    Intermediate: "fewshot_intermediate.json",
    Advanced: "fewshot_advanced.json",
}
const DEFAULT_FEWSHOT_FILE = "fewshot_intermediate.json"

/** Regex for punctuation-only tokens */
const PUNCTUATION_ONLY_RE = /^[\p{P}\p{S}]+$/u

/** Regex for number-only tokens */
const NUMBER_ONLY_RE = /^[\d.,]+$/

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate auto-translation candidates using a local LLM
 *
 * @param params - Auto-candidates request data
 * @param config - LLM provider configuration
 * @returns Auto-candidates response data matching the cloud API format
 */
export async function generateAutoCandidates(
    params: AutoCandidatesRequestData,
    config: LLMConfig
): Promise<AutoCandidatesResponseData> {
    const service = new AutoCandidatesGenerationService(config)
    await service.initialize()
    return service.generate(params)
}

/**
 * Auto-Candidates Generation Service
 *
 * Class-based service with pre-initialized prompts and LLM client
 */
export class AutoCandidatesGenerationService {
    private client: OpenAICompatibleClient
    private systemPrompt: string | null = null
    private userPromptTemplate: string | null = null

    constructor(config: LLMConfig) {
        this.client = new OpenAICompatibleClient(config)
        logger.info("AutoCandidatesGenerationService initialized")
    }

    /** Load prompt templates from resources (call once before generate) */
    async initialize(): Promise<void> {
        logger.debug("Loading prompts for auto-candidates")
        this.systemPrompt = await promptLoaderModule.loadSystemPrompt(constants.TASK_AUTO_CANDIDATES)
        this.userPromptTemplate = await promptLoaderModule.loadUserPromptTemplate(constants.TASK_AUTO_CANDIDATES)
        logger.info("Auto-candidates prompts loaded successfully")
    }

    /**
     * Generate auto-candidates for a text block
     *
     * @param params - Request data (sourceLang, targetLang, blockText, etc.)
     * @returns Response matching AutoCandidatesResponseData
     */
    async generate(params: AutoCandidatesRequestData): Promise<AutoCandidatesResponseData> {
        if (!this.systemPrompt || !this.userPromptTemplate) {
            throw new Error("Service not initialized. Call initialize() first.")
        }

        const traceId = `local_auto_${Date.now()}`
        const effectiveLimit = computeEffectiveLimit(params.blockText, params.userLevel)

        logger.debug("Starting auto-candidates generation:", {
            sourceLang: params.sourceLang,
            limit: effectiveLimit,
        })

        try {
            const messages = await this.buildMessages(params, effectiveLimit)
            const rawContent = await this.client.generate(messages)
            const candidates = processLLMOutput(rawContent, params, effectiveLimit)

            logger.info("Auto-candidates generation completed:", {
                traceId,
                candidateCount: candidates.length,
            })

            return {
                traceId,
                candidates,
                meta: {
                    sourceLang: params.sourceLang,
                    targetLang: params.targetLang,
                    limitApplied: effectiveLimit,
                    degraded: false,
                    model: "local",
                },
            }
        } catch (error) {
            logger.error("Auto-candidates generation failed:", error)

            // Degrade to empty — never throw for auto-candidates
            return {
                traceId,
                candidates: [],
                meta: {
                    sourceLang: params.sourceLang,
                    targetLang: params.targetLang,
                    limitApplied: effectiveLimit,
                    degraded: true,
                    model: "local",
                },
                warnings: [error instanceof Error ? error.message : String(error)],
            }
        }
    }

    // ========================================================================
    // Message Construction
    // ========================================================================

    private async buildMessages(params: AutoCandidatesRequestData, effectiveLimit: number): Promise<ChatMessage[]> {
        const userPrompt = this.buildUserPrompt(params, effectiveLimit)
        const fewshotFile = LEVEL_TO_FEWSHOT_FILE[params.userLevel] ?? DEFAULT_FEWSHOT_FILE
        const fewshotMessages = await promptLoaderModule.loadFewshot(
            constants.TASK_AUTO_CANDIDATES,
            params.targetLang,
            fewshotFile
        )
        return [
            { role: "system" as const, content: this.systemPrompt! },
            ...fewshotMessages,
            { role: "user" as const, content: userPrompt },
        ]
    }

    private buildUserPrompt(params: AutoCandidatesRequestData, effectiveLimit: number): string {
        const variables: Record<string, string> = {
            sourceLang: params.sourceLang,
            targetLang: params.targetLang,
            userLevel: params.userLevel,
            limit: String(effectiveLimit),
            blockText: params.blockText,
        }
        return templateRendererModule.renderTemplate(this.userPromptTemplate!, variables)
    }
}

// ============================================================================
// Post-Processing Pipeline
// ============================================================================

/** Raw LLM candidate before post-processing */
interface RawLLMCandidate {
    reason?: string
    text?: string
    type?: string
    translation?: string
}

/** Raw LLM response envelope */
interface RawLLMResponse {
    candidates?: RawLLMCandidate[]
}

/**
 * Full post-processing pipeline: parse → validate → expand offsets →
 * filter excluded → remove noise → deduplicate → phrase-over-word →
 * strip reason → enforce limit
 */
function processLLMOutput(
    rawContent: string,
    params: AutoCandidatesRequestData,
    effectiveLimit: number
): AutoCandidate[] {
    // Stage 1: Parse JSON
    let parsed: RawLLMResponse
    try {
        parsed = JSON.parse(rawContent) as RawLLMResponse
    } catch {
        logger.error("Failed to parse LLM JSON response")
        return []
    }

    if (!Array.isArray(parsed.candidates)) {
        logger.warn("LLM response missing candidates array")
        return []
    }

    // Stage 2: Validate candidate structure
    const validRaw = parsed.candidates.filter(isValidRawCandidate)
    logger.debug(`Stage 2 — validated candidates: ${validRaw.length}/${parsed.candidates.length}`)

    // Stage 3: Compute offsets & expand occurrences
    let expanded = expandOccurrences(validRaw, params.blockText)
    logger.debug(`Stage 3 — expanded to ${expanded.length} entries`)

    // Stage 4: Remove excluded items (manualTrigger + excludedTexts)
    expanded = filterExcluded(expanded, params.excludedTexts, params.manualTrigger?.text)
    logger.debug(`Stage 4 — after exclusion filter: ${expanded.length}`)

    // Stage 5: Remove noise tokens
    expanded = removeNoise(expanded)
    logger.debug(`Stage 5 — after noise removal: ${expanded.length}`)

    // Stage 5b: Filter candidates where translation ≈ source text
    expanded = filterSameAsSource(expanded)
    logger.debug(`Stage 5b — after same-as-source filter: ${expanded.length}`)

    // Stage 6: Deduplicate by normalized text
    expanded = deduplicateByText(expanded)
    logger.debug(`Stage 6 — after dedup: ${expanded.length}`)

    // Stage 7: Longer-span precedence
    expanded = applyLongerSpanPrecedence(expanded)
    logger.debug(`Stage 7 — after longer-span precedence: ${expanded.length}`)

    // Stage 8: Strip reason & set source (reason preserved in raw only for CoT quality)
    const stripped: AutoCandidate[] = expanded.map((c) => ({
        text: c.text,
        type: c.type as "word" | "phrase",
        start: c.start,
        end: c.end,
        translation: c.translation,
        source: "llm" as const,
    }))

    // Stage 9: Enforce capped upper bound
    const capped = stripped.slice(0, effectiveLimit)
    logger.debug(`Stage 9 — final count: ${capped.length}`)

    return capped
}

// ============================================================================
// Pipeline Stage Helpers
// ============================================================================

/** Intermediate candidate with computed offsets (reason still present) */
interface ExpandedCandidate {
    reason: string
    text: string
    type: string
    translation: string
    start: number
    end: number
}

/** Stage 2: Validate that a raw candidate has all required fields */
function isValidRawCandidate(c: RawLLMCandidate): boolean {
    return (
        typeof c.text === "string" &&
        c.text.trim().length > 0 &&
        typeof c.type === "string" &&
        (c.type === "word" || c.type === "phrase") &&
        typeof c.translation === "string" &&
        c.translation.trim().length > 0 &&
        typeof c.reason === "string"
    )
}

/** Stage 3: Find ALL occurrences of each candidate text in blockText */
function expandOccurrences(candidates: RawLLMCandidate[], blockText: string): ExpandedCandidate[] {
    const results: ExpandedCandidate[] = []
    for (const c of candidates) {
        const text = c.text!
        let searchFrom = 0
        let found = false
        while (true) {
            const start = blockText.indexOf(text, searchFrom)
            if (start === -1) break
            found = true
            results.push({
                reason: c.reason ?? "",
                text,
                type: c.type!,
                translation: c.translation!,
                start,
                end: start + text.length,
            })
            searchFrom = start + 1
        }
        if (!found) {
            logger.debug(`Candidate text not found in block, dropping: "${text}"`)
        }
    }
    return results
}

/** Stage 4: Remove candidates matching excludedTexts or manualTrigger (case-insensitive) */
function filterExcluded(
    candidates: ExpandedCandidate[],
    excludedTexts: string[],
    manualTriggerText?: string
): ExpandedCandidate[] {
    const excludeSet = new Set(
        [...excludedTexts, ...(manualTriggerText ? [manualTriggerText] : [])].map((t) => t.toLowerCase().trim())
    )
    if (excludeSet.size === 0) return candidates
    return candidates.filter((c) => !excludeSet.has(c.text.toLowerCase().trim()))
}

/** Stage 5: Remove punctuation-only, number-only, single-char tokens */
function removeNoise(candidates: ExpandedCandidate[]): ExpandedCandidate[] {
    return candidates.filter((c) => {
        const trimmed = c.text.trim()
        if (trimmed.length <= 1) return false
        if (PUNCTUATION_ONLY_RE.test(trimmed)) return false
        if (NUMBER_ONLY_RE.test(trimmed)) return false
        return true
    })
}

/** Stage 5b: Filter candidates where translation is identical to source text */
function filterSameAsSource(candidates: ExpandedCandidate[]): ExpandedCandidate[] {
    return candidates.filter((c) => {
        const normalizedText = c.text.toLowerCase().trim()
        const normalizedTranslation = c.translation.toLowerCase().trim()
        if (normalizedText === normalizedTranslation) {
            logger.debug(`Dropping same-as-source candidate: "${c.text}" → "${c.translation}"`)
            return false
        }
        return true
    })
}

/** Stage 6: Deduplicate by normalized text (case-insensitive, trimmed) — keep first occurrence */
function deduplicateByText(candidates: ExpandedCandidate[]): ExpandedCandidate[] {
    const seen = new Set<string>()
    return candidates.filter((c) => {
        const key = `${c.text.toLowerCase().trim()}|${c.start}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}

/** Stage 7: Longer-span precedence — drop ANY candidate fully contained within a longer candidate */
function applyLongerSpanPrecedence(candidates: ExpandedCandidate[]): ExpandedCandidate[] {
    return candidates.filter((c) => {
        const cLen = c.end - c.start
        // Drop this candidate if any OTHER candidate fully contains it AND is strictly longer
        const containedByLonger = candidates.some((other) => {
            if (other === c) return false
            const otherLen = other.end - other.start
            return otherLen > cLen && other.start <= c.start && other.end >= c.end
        })
        return !containedByLonger
    })
}
