/**
 * Auto-Translation Orchestrator Service
 *
 * Core auto-translation logic triggered after a successful manual translation.
 * Extracts block text, requests auto-candidates from backend, filters them,
 * maps to DOM Ranges, and renders using the existing translation display system.
 *
 * Design principles:
 * - Fire-and-forget: never blocks manual translation rendering
 * - Silent failure: all errors logged at warn level, never user-facing
 * - Scan-once: each block element is scanned at most once per page lifecycle
 * - Conservative filtering: prefer under-selection over over-selection
 */

import type { AutoCandidate, AutoCandidatesRequestData } from "@/0_common/types"
import { DEFAULT_USER_SETTINGS } from "@/0_common/types"
import * as translationFontSizeModule from "@/0_common/constants/translationFontSize"
import * as loggerModule from "@/0_common/utils/logger"
import * as contentIndex from "@/1_content/index"
import * as translationRequest from "@/1_content/services/translationRequest"
import * as translationDisplay from "@/1_content/ui/translationDisplayV2"
import type { DisplayUserSettings } from "@/1_content/ui/translationDisplayV2"
import type { SuccessState } from "@/1_content/ui/translationDisplayV2/types"
import * as translationOverlapDetector from "@/1_content/handlers/utils/translationOverlapDetectorV2"
import * as domSanitizer from "@/1_content/utils/domSanitizer"
import * as blockTextExtractor from "@/1_content/utils/blockTextExtractor"
import type { TextNodeSegment } from "@/1_content/utils/blockTextExtractor"
import * as candidateDomMapper from "@/1_content/utils/candidateDomMapper"

const logger = loggerModule.createLogger("autoTranslationService")

// ============================================================================
// Public Interface
// ============================================================================

export interface AutoTriggerParams {
    triggerRange: Range
    triggerText: string
    triggerType: "word" | "phrase"
    triggerTranslation: string
    detectedLang: string
    targetLang: string
}

/**
 * Attempt auto-translation for the block containing the manual trigger.
 * Fire-and-forget — never throws, never shows user-facing errors.
 */
export async function tryAutoTranslate(params: AutoTriggerParams): Promise<void> {
    try {
        await executeAutoTranslation(params)
    } catch (error) {
        logger.warn("Auto-translation failed silently:", error)
    }
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum block text length to trigger auto-translation */
const MIN_BLOCK_TEXT_LENGTH = 30

/** Maximum total translations (manual + auto) per block element */
const MAX_TRANSLATIONS_PER_BLOCK = 30

/** Delay between rendering successive auto-candidates (ms) */
const RENDER_STAGGER_MS = 50

/** Providers that do not support auto-candidate selection */
const UNSUPPORTED_PROVIDERS = new Set(["mtranserver", "bingTranslate"])

// ============================================================================
// State
// ============================================================================

/** Tracks which block elements have already been scanned (scan-once rule) */
const scannedBlocks = new WeakSet<Element>()

/** Tracks rendered auto-translation offset ranges per block (dedup by "start:end") */
const autoRenderedOffsets = new WeakMap<Element, Set<string>>()

// ============================================================================
// Internal: Main Flow
// ============================================================================

async function executeAutoTranslation(params: AutoTriggerParams): Promise<void> {
    // Check feature enabled
    const settings = contentIndex.getCachedUserSettings()
    if (!settings?.enableAutoTranslate) return

    // Check provider support
    const provider = settings.translationProvider
    if (UNSUPPORTED_PROVIDERS.has(provider)) {
        logger.info("Auto-translation not supported for provider:", provider)
        return
    }

    // Resolve block element
    const blockElement = domSanitizer.getClosestBlockAncestor(params.triggerRange.startContainer)

    // Scan-once check
    if (scannedBlocks.has(blockElement)) return
    scannedBlocks.add(blockElement)

    // Extract block text with offset mapping
    const { blockText, textNodes } = blockTextExtractor.extractBlockText(blockElement)

    // Minimum length check
    if (blockText.length < MIN_BLOCK_TEXT_LENGTH) return

    // Build excluded texts from existing translations in this block
    const excludedTexts = buildExcludedTexts(blockElement, params.triggerText)

    const requestData: AutoCandidatesRequestData = {
        sourceLang: params.detectedLang,
        targetLang: params.targetLang,
        blockText,
        manualTrigger: {
            text: params.triggerText,
            type: params.triggerType === "phrase" ? "phrase" : "word",
            translation: params.triggerTranslation,
        },
        userLevel: settings.userLanguageProficiency,
        excludedTexts,
    }

    // Send request
    const response = await translationRequest.requestAutoCandidates(requestData)

    if (!response.success) {
        logger.warn("Auto-candidates request failed:", response.error)
        return
    }

    if (response.data.candidates.length === 0) return

    logger.info("Auto-candidates response:", {
        traceId: response.data?.traceId,
        candidateCount: response.data?.candidates?.length ?? 0,
        degraded: response.data?.meta?.degraded ?? false,
        blockTextLength: blockText.length,
        userLevel: settings.userLanguageProficiency,
    })

    // Post-response safety: verify block is still in the DOM
    if (!blockElement.isConnected) {
        logger.warn("Block element removed during async request, abandoning")
        return
    }

    // Filter and render candidates
    await processAndRenderCandidates(
        response.data.candidates,
        blockElement,
        blockText,
        textNodes,
        params
    )
}

// ============================================================================
// Internal: Excluded Texts
// ============================================================================

/**
 * Build the excludedTexts array from the manual trigger and existing translations.
 * Sent to backend for hard-rule pipeline filtering (not passed to LLM prompt).
 */
function buildExcludedTexts(blockElement: Element, manualTriggerText: string): string[] {
    const excluded: string[] = []

    // The manually triggered word/phrase
    excluded.push(manualTriggerText.toLowerCase())

    // All existing translations in this block
    const activeRanges = translationDisplay.getActiveRanges()
    for (const [, range] of activeRanges) {
        if (blockElement.contains(range.startContainer)) {
            const text = range.toString().trim()
            if (text.length > 0) {
                excluded.push(text.toLowerCase())
            }
        }
    }

    // Deduplicate
    return [...new Set(excluded)]
}

// ============================================================================
// Internal: Candidate Filtering & Rendering
// ============================================================================

/**
 * Multi-stage filtering pipeline followed by sequential rendering.
 */
async function processAndRenderCandidates(
    candidates: AutoCandidate[],
    blockElement: Element,
    blockText: string,
    textNodes: TextNodeSegment[],
    params: AutoTriggerParams
): Promise<void> {
    const displaySettings = buildDisplaySettings()

    // Initialize rendered offsets tracking for this block
    if (!autoRenderedOffsets.has(blockElement)) {
        autoRenderedOffsets.set(blockElement, new Set<string>())
    }
    const renderedOffsets = autoRenderedOffsets.get(blockElement)!

    // Compute remaining visual budget for this block
    let remainingBudget = computeRemainingBudget(blockElement)
    if (remainingBudget <= 0) return

    // Build set of excluded texts (defense-in-depth, post-response)
    const excludedLower = new Set(buildExcludedTexts(blockElement, params.triggerText))

    const filteredCandidates: Array<{ candidate: AutoCandidate; range: Range }> = []

    // Filtering counters for anomaly detection
    let droppedByExclusion = 0
    let droppedByDedup = 0
    let droppedByDomMapping = 0
    let droppedByOverlap = 0
    let droppedByBudget = 0

    for (const candidate of candidates) {
        // Stage 1 & 2: Skip already-translated items (defense-in-depth)
        if (excludedLower.has(candidate.text.toLowerCase())) {
            droppedByExclusion++
            continue
        }

        // Stage 3: Skip already-rendered auto-translations (dedup by offset)
        const offsetKey = `${candidate.start}:${candidate.end}`
        if (renderedOffsets.has(offsetKey)) {
            droppedByDedup++
            continue
        }

        // Stage 4: DOM Range validation
        const candidateRange = candidateDomMapper.mapCandidateToRange(candidate, textNodes, blockText)
        if (!candidateRange) {
            droppedByDomMapping++
            logger.warn("Auto-candidate DOM mapping failed:", {
                text: candidate.text,
                start: candidate.start,
                end: candidate.end,
                blockTextAtOffset: blockText.substring(candidate.start, candidate.end),
            })
            continue
        }

        // Stage 5: Overlap detection with existing translations
        if (candidateOverlapsExisting(candidateRange)) {
            droppedByOverlap++
            continue
        }

        // Stage 6: Density check
        if (remainingBudget <= 0) {
            droppedByBudget++
            break
        }
        remainingBudget--

        filteredCandidates.push({ candidate, range: candidateRange })
        renderedOffsets.add(offsetKey)
    }

    // Intra-batch overlap removal: if two candidates overlap, keep the longer one
    const nonOverlapping = removeIntraBatchOverlaps(filteredCandidates)
    const droppedByIntraBatchOverlap = filteredCandidates.length - nonOverlapping.length

    logger.info("Auto-candidates filtering summary:", {
        received: candidates.length,
        afterFiltering: filteredCandidates.length,
        afterIntraBatchOverlap: nonOverlapping.length,
        droppedByExclusion,
        droppedByDedup,
        droppedByDomMapping,
        droppedByOverlap,
        droppedByIntraBatchOverlap,
        droppedByBudget,
    })

    // Render surviving candidates with stagger delay
    for (let i = 0; i < nonOverlapping.length; i++) {
        if (i > 0) await delay(RENDER_STAGGER_MS)

        const entry = nonOverlapping[i]
        if (!entry) continue
        const { candidate, range } = entry

        // Re-verify block is still connected before each render
        if (!blockElement.isConnected) break

        renderAutoCandidate(range, candidate, displaySettings)
    }
}

/**
 * Check if a candidate Range overlaps with any existing active translation.
 */
function candidateOverlapsExisting(candidateRange: Range): boolean {
    const activeRanges = translationDisplay.getActiveRanges()
    const overlapping = translationOverlapDetector.detectOverlappingTranslations(candidateRange, activeRanges)
    return overlapping.length > 0
}

/**
 * Compute how many more translations can be added to this block.
 */
function computeRemainingBudget(blockElement: Element): number {
    const activeRanges = translationDisplay.getActiveRanges()
    let count = 0
    for (const [, range] of activeRanges) {
        if (blockElement.contains(range.startContainer)) count++
    }
    return Math.max(0, MAX_TRANSLATIONS_PER_BLOCK - count)
}

/**
 * Render a single auto-candidate using the existing translation display system.
 */
function renderAutoCandidate(
    candidateRange: Range,
    candidate: AutoCandidate,
    displaySettings: DisplayUserSettings
): string | null {
    try {
        const state: SuccessState = {
            status: "success",
            translation: candidate.translation,
        }

        // Map candidate type to translation display type
        const translationType = candidate.type === "phrase" ? "fragment" : "word"

        const anchorId = translationDisplay.showTranslationResult(
            candidateRange,
            candidate.text,
            state,
            undefined, // no context needed for auto-translations
            undefined, // no refresh callback
            translationType,
            displaySettings
        )

        // Apply auto-translation visual style (teal, thinner underline)
        translationDisplay.addTooltipClass(anchorId, "ai-translator-tooltip--auto")

        return anchorId
    } catch (error) {
        logger.warn(`Failed to render auto-candidate "${candidate.text}":`, error)
        return null
    }
}

/**
 * Build display settings from current user settings.
 * Mirrors the pattern used in TranslationPipeline.buildDisplaySettings().
 */
function buildDisplaySettings(): DisplayUserSettings {
    const settings = contentIndex.getCachedUserSettings() ?? DEFAULT_USER_SETTINGS
    const resolvedFont = translationFontSizeModule.resolveTranslationFontSize(settings.translationFontSizePreset)
    return {
        translationFontSizePreset: resolvedFont.preset,
        autoAdjustHeight: settings.autoAdjustHeight ?? true,
    }
}

// ============================================================================
// Internal: Utility
// ============================================================================

/**
 * Remove intra-batch overlapping candidates.
 * When two candidates' [start, end) ranges overlap, keep the one with the longer text.
 */
function removeIntraBatchOverlaps(
    entries: Array<{ candidate: AutoCandidate; range: Range }>
): Array<{ candidate: AutoCandidate; range: Range }> {
    // Sort by start position, then by length descending (longer first)
    const sorted = [...entries].sort((a, b) => {
        const startDiff = a.candidate.start - b.candidate.start
        if (startDiff !== 0) return startDiff
        return (b.candidate.end - b.candidate.start) - (a.candidate.end - a.candidate.start)
    })

    const result: Array<{ candidate: AutoCandidate; range: Range }> = []
    for (const entry of sorted) {
        const overlaps = result.some((kept) => {
            // Two ranges [s1,e1) and [s2,e2) overlap if s1 < e2 && s2 < e1
            return kept.candidate.start < entry.candidate.end && entry.candidate.start < kept.candidate.end
        })
        if (!overlaps) {
            result.push(entry)
        }
    }
    return result
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
