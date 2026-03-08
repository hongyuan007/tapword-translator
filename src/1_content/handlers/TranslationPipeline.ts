/**
 * Translation Pipeline
 *
 * Handles translation flow for a given Range without direct event bindings.
 */

import { ERROR_MESSAGES, UPGRADE_MODEL_ENABLED } from "@/0_common/constants"
import * as translationFontSizeModule from "@/0_common/constants/translationFontSize"
import { type TranslationFontSizePreset, DEFAULT_USER_SETTINGS } from "@/0_common/types"
import * as i18nModule from "@/0_common/utils/i18n"
import * as loggerModule from "@/0_common/utils/logger"
import * as contentIndex from "@/1_content/index"
import * as translationRequest from "@/1_content/services/translationRequest"
import * as iconManager from "@/1_content/ui/iconManager"
import * as translationDisplay from "@/1_content/ui/translationDisplay"
import { extractContextV2 } from "@/1_content/utils/contextExtractorV2"
import * as domSanitizer from "@/1_content/utils/domSanitizer"
import * as languageDetector from "@/1_content/utils/languageDetector"
import * as rangeSplitter from "@/1_content/handlers/utils/rangeSplitter"
import * as rangeAdjuster from "@/1_content/handlers/utils/rangeAdjuster"
import * as selectionClassifier from "@/1_content/handlers/utils/selectionClassifier"
import * as translationOverlapDetector from "@/1_content/handlers/utils/translationOverlapDetector"
import * as editableElementDetector from "@/1_content/handlers/utils/editableElementDetector"
import { createConcurrencyLimiter, type RequestLimiter } from "@/1_content/utils/concurrencyLimiter"

const logger = loggerModule.createLogger("selectionHandler")
const MAX_PARALLEL_TRANSLATIONS = 3

function buildDisplaySettings(settings: Partial<{ translationFontSizePreset?: TranslationFontSizePreset; autoAdjustHeight?: boolean }> | null) {
    const resolvedFont = translationFontSizeModule.resolveTranslationFontSize(settings?.translationFontSizePreset)

    return {
        translationFontSizePreset: resolvedFont.preset,
        translationFontSize: resolvedFont.px,
        autoAdjustHeight: settings?.autoAdjustHeight ?? true,
    }
}

/**
 * Triggers the translation process for a given selection and range.
 * This function is called when the translation icon is clicked.
 * @param selection - The captured Selection object.
 * @param range - The captured Range object.
 */
export async function handleIconClick(selection: Selection, range: Range): Promise<void> {
    if (!selection || !range) {
        logger.warn("No selection available for translation.")
        return
    }

    const container = range.commonAncestorContainer
    const element = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement

    if (editableElementDetector.isEditableElement(element)) {
        logger.info("Icon click inside an editable element, skipping translation.")
        iconManager.removeTranslationIcon()
        return
    }

    // Remove the icon
    iconManager.removeTranslationIcon()

    // Clear the selection to remove the browser's native highlight
    if (selection) {
        selection.removeAllRanges()
    }

    await triggerTranslationWithSplit(range, "Icon Click")
}

export async function triggerTranslationForRange(
    range: Range,
    triggerSource: string,
    loadingVariant: "text" | "spinner" = "text"
): Promise<void> {
    const limiter = createConcurrencyLimiter(MAX_PARALLEL_TRANSLATIONS)
    await processTranslation(range, triggerSource, limiter, loadingVariant)
}

export async function triggerTranslationWithSplit(range: Range, baseLabel: string): Promise<void> {
    const splitRanges = rangeSplitter.splitRangeByBlocks(range)
    const targets = splitRanges.length > 0 ? splitRanges : [range]

    const triggerLabel = targets.length > 1 ? `${baseLabel} (Split)` : baseLabel
    const limiter = createConcurrencyLimiter(MAX_PARALLEL_TRANSLATIONS)
    const loadingVariant: "text" | "spinner" = targets.length > 1 ? "spinner" : "text"
    await runBatchedTranslations(triggerLabel, targets, limiter, loadingVariant)
}

async function runBatchedTranslations(
    triggerLabel: string,
    ranges: Range[],
    limiter: RequestLimiter,
    loadingVariant: "text" | "spinner"
): Promise<void> {
    await Promise.all(ranges.map((targetRange) => processTranslation(targetRange, triggerLabel, limiter, loadingVariant)))
}

/**
 * Core translation logic that handles language detection and routing.
 * Shared by both icon click and double-click handlers.
 *
 * @param range - The Range object containing the selected text
 * @param triggerSource - Source of the trigger for logging purposes
 */
async function processTranslation(
    range: Range,
    triggerSource: string,
    limiter?: RequestLimiter,
    loadingVariant: "text" | "spinner" = "text"
): Promise<void> {
    // Sanitize selection text to exclude our UI (e.g., tooltip content)
    const rawText = domSanitizer.getCleanTextFromRange(range)
    const sanitizedText = rawText.trim()
    logger.info(`[${triggerSource}] Translation requested for:`, sanitizedText)

    // Detect language from block context once; reuse for both routing decisions and API sourceLanguage.
    // Block context (full paragraph) is far more reliable than the selected word alone —
    // chrome.i18n.detectLanguage misidentifies short strings (e.g. "nominated" → "la").
    // Mixed CJK/Latin context returns "auto", which resolveTargetLanguage handles correctly.
    const textForRouting = domSanitizer.getSurroundingTextForDetection(range, 30)
    const detectedLang = await languageDetector.detectSourceLanguageAsync(textForRouting)
    const routingLang = detectedLang
    const selectionLang = detectedLang
    logger.info(`[${triggerSource}] Detected language (block context):`, detectedLang)

    // Check if the selection actually contains CJK characters.
    // This is more reliable for classification structure routing (Word vs Fragment path).
    const hasCJK = languageDetector.hasCJKCharacters(sanitizedText)

    // Check if the language is CJK (Chinese, Japanese, Korean) or similar non-space-delimited languages
    // Use hasCJK check for selection to strictly prevent false positives
    const isCJKLanguage = ["zh", "ja", "ko"].includes(routingLang) || hasCJK

    if (isCJKLanguage) {
        // For CJK languages: Trust user's selection, skip classification and expansion
        // These languages don't use spaces to separate words, so user selection is the most reliable unit
        logger.info(`[${triggerSource}] [CJK Language] Treating selection as fragment, skipping classification and expansion`)
        const trimRes = rangeAdjuster.trimBoundaryWhitespace(range)
        const workingRange = trimRes.range
        const fragment = domSanitizer.getCleanTextFromRange(workingRange).trim()
        await translateFragmentPath(workingRange, fragment, selectionLang, limiter, loadingVariant)
    } else {
        // For space-delimited languages (English, etc.): Use existing classification and expansion logic
        logger.info(`[${triggerSource}] [Space-delimited Language] Using classification and boundary expansion`)

        // Step 1: Trim boundary whitespace (prevents expanding into next word when trailing space selected)
        const trimRes = rangeAdjuster.trimBoundaryWhitespace(range)
        let workingRange = trimRes.range

        // Step 2: Classify selection based on trimmed range
        const cls = selectionClassifier.detectSelectionType(workingRange)

        // Step 3: Adjust range based on classification rules
        if (cls.type === "word") {
            if (!cls.isComplete) {
                const exp = rangeAdjuster.expandToWordBoundaries(workingRange)
                workingRange = exp.range
            }
            const word = domSanitizer.getCleanTextFromRange(workingRange).trim()
            await translateWordPath(workingRange, word, selectionLang, limiter, loadingVariant)
        } else {
            // Fragment: if boundary whitespace was trimmed, skip expansion; else expand to word boundaries
            if (!cls.isComplete) {
                const exp = rangeAdjuster.expandToWordBoundaries(workingRange)
                workingRange = exp.range
            }
            const fragment = domSanitizer.getCleanTextFromRange(workingRange).trim()
            await translateFragmentPath(workingRange, fragment, selectionLang, limiter, loadingVariant)
        }
    }
}

// ============================================================================
// Translation Path Functions
// ============================================================================

/**
 * Word translation path - uses translateWord API
 *
 * @param range - Selection range
 * @param word - The word to translate
 * @param detectedLang - Pre-detected source language from processTranslation
 */
async function translateWordPath(
    range: Range,
    word: string,
    detectedLang: string,
    limiter?: RequestLimiter,
    loadingVariant: "text" | "spinner" = "text"
): Promise<void> {
    logger.info("[Word Path] Translating word:", word, "| Language:", detectedLang)

    // IMPORTANT: Extract context BEFORE any DOM mutations (wrap/cleanup)
    const v2 = extractContextV2(range)

    const context = {
        word,
        leadingText: v2.leadingText,
        trailingText: v2.trailingText,
        originalSentence: v2.currentSentence,
        previousSentences: v2.previousSentences.length ? v2.previousSentences : undefined,
        nextSentences: v2.nextSentences.length ? v2.nextSentences : undefined,
        bookName: `网页<<${document.title}>>`,
        sourceLanguage: detectedLang, // Use pre-detected language
    }

    // Fetch latest user settings once before rendering to avoid stale values
    const userSettings = contentIndex.getCachedUserSettings() ?? DEFAULT_USER_SETTINGS
    const displaySettings = buildDisplaySettings(userSettings)

    // Create refresh callback that re-triggers this translation with latest settings
    let anchorId = ""
    const performRequest = async (upgradeModel: boolean = UPGRADE_MODEL_ENABLED) => {
        try {
            const userTargetLang = userSettings?.targetLanguage || contentIndex.getCachedUserSettings()?.targetLanguage || "zh" // Fallback to 'zh'
            const targetLang = languageDetector.resolveTargetLanguage(detectedLang, userTargetLang)
            logger.info("[Word Path] Target language:", targetLang, "(user setting:", userTargetLang, ")")

            const payload = {
                ...context,
                targetLanguage: targetLang,
                ...(upgradeModel && { upgradeModel: true }),
            }
            const requestFn = () => translationRequest.requestTranslation(payload)
            const response = limiter ? await limiter(requestFn) : await requestFn()
            if (response.success) {
                translationDisplay.updateTranslationResult(
                    anchorId,
                    {
                        status: "success",
                        translation: response.data.wordTranslation,
                        sentenceTranslation: response.data.sentenceTranslation,
                        chineseDefinition: response.data.chineseDefinition,
                        englishDefinition: response.data.englishDefinition,
                        targetDefinition: response.data.targetDefinition,
                        targetLanguage: targetLang,
                        lemma: response.data.lemma,
                        phonetic: response.data.phonetic,
                        lemmaPhonetic: response.data.lemmaPhonetic,
                    },
                    displaySettings
                )
            } else {
                // Check errorType to determine error handling
                // QuotaExceeded: use short message for tooltip, keep detailed message for modal
                // TranslationError: use the specific error message from backend
                // GenericError: use fallback SERVER_BUSY message
                let tooltipText = response.shortMessage || "翻译失败"
                let errorMessage: string = ERROR_MESSAGES.SERVER_BUSY

                if (response.errorType === "QuotaExceeded") {
                    tooltipText = response.shortMessage || ERROR_MESSAGES.QUOTA_EXCEEDED_SHORT
                    errorMessage = response.error // Keep detailed message for modal
                } else if (response.errorType === "TranslationError") {
                    errorMessage = response.error
                }

                translationDisplay.updateTranslationResult(
                    anchorId,
                    {
                        status: "error",
                        text: tooltipText,
                        errorMessage: errorMessage,
                    },
                    displaySettings
                )
                logger.error("Word translation error:", response.error)
            }
        } catch (error) {
            translationDisplay.updateTranslationResult(
                anchorId,
                {
                    status: "error",
                    text: "翻译失败",
                    errorMessage: ERROR_MESSAGES.SERVER_BUSY,
                },
                displaySettings
            )
            logger.error("Word translation request failed:", error)
        }
    }

    // Detect overlapping translations BEFORE wrapping (collect IDs only)
    const preWrapOverlappingIds = translationOverlapDetector.detectOverlappingTranslations(range)

    // Show loading state with full context and refresh callback (this wraps the selection)
    const refreshCallback = async () => {
        logger.info("[Word Path] Refreshing translation for:", word)
        await performRequest(true)
    }
    anchorId = translationDisplay.showTranslationResult(
        range,
        word,
        {
            status: "loading",
            text: i18nModule.translate("modal.loading"),
            loadingVariant,
        },
        context,
        refreshCallback,
        "word", // Specify this is a word translation
        displaySettings
    )

    // After wrapping, remove ALL instances of pre-detected overlapping anchors by ID
    // This handles cases where a previous anchor was split and duplicated (nested clone + leftover)
    try {
        const toRemove = preWrapOverlappingIds.filter((id) => id !== anchorId)
        if (toRemove.length > 0) {
            logger.info("[Word Path] Removing overlapping translations after wrap:", toRemove)
            toRemove.forEach((id) => {
                // Remove every instance with this ID until none remain
                // (defensive: in case partial overlaps created duplicates)
                while (document.getElementById(id)) {
                    translationDisplay.removeTranslationResult(id)
                }
            })
        }
    } catch (e) {
        logger.warn("[Word Path] Overlap cleanup after wrap failed:", e)
    }

    // Begin async language detection and then request translation
    await performRequest()
}

/**
 * Fragment translation path - uses translateFragment API
 *
 * @param range - Selection range (possibly expanded)
 * @param fragment - The text fragment to translate
 * @param detectedLang - Pre-detected source language from processTranslation
 */
async function translateFragmentPath(
    range: Range,
    fragment: string,
    detectedLang: string,
    limiter?: RequestLimiter,
    loadingVariant: "text" | "spinner" = "text"
): Promise<void> {
    logger.info("[Fragment Path] Translating fragment:", fragment, "| Language:", detectedLang)

    // IMPORTANT: Extract context BEFORE any DOM mutations (wrap/cleanup)
    logger.info("[Fragment Path] Extracting context before wrap/cleanup")
    const v2 = extractContextV2(range)

    const context = {
        word: fragment, // for UI typing convenience; not used by fragment request
        leadingText: v2.leadingText,
        trailingText: v2.trailingText,
        originalSentence: v2.currentSentence,
        previousSentences: v2.previousSentences.length ? v2.previousSentences : undefined,
        nextSentences: v2.nextSentences.length ? v2.nextSentences : undefined,
        bookName: `网页<<${document.title}>>`,
        sourceLanguage: detectedLang, // Use pre-detected language
    }

    logger.info("[Fragment Path] Context extracted:", {
        leadingText: context.leadingText,
        trailingText: context.trailingText,
        fragment: fragment,
    })

    // Fetch latest user settings once before rendering to avoid stale values
    const userSettings = contentIndex.getCachedUserSettings() ?? DEFAULT_USER_SETTINGS
    const displaySettings = buildDisplaySettings(userSettings)

    // Prepare async performRequest
    let anchorId = ""
    const performFragmentRequest = async (upgradeModel: boolean = UPGRADE_MODEL_ENABLED) => {
        try {
            const userTargetLang = userSettings?.targetLanguage || contentIndex.getCachedUserSettings()?.targetLanguage || "zh" // Fallback to 'zh'
            const targetLang = languageDetector.resolveTargetLanguage(detectedLang, userTargetLang)
            logger.info("[Fragment Path] Target language:", targetLang, "(user setting:", userTargetLang, ")")

            const requestPayload = {
                fragment,
                leadingText: context.leadingText,
                trailingText: context.trailingText,
                previousSentences: context.previousSentences,
                nextSentences: context.nextSentences,
                bookName: context.bookName,
                sourceLanguage: detectedLang,
                targetLanguage: targetLang,
                ...(upgradeModel && { upgradeModel: true }),
            }
            const requestFn = () => translationRequest.requestFragmentTranslation(requestPayload)
            const response = limiter ? await limiter(requestFn) : await requestFn()
            if (response.success) {
                translationDisplay.updateTranslationResult(
                    anchorId,
                    {
                        status: "success",
                        translation: response.data.translation,
                        sentenceTranslation: response.data.sentenceTranslation,
                    },
                    displaySettings
                )
            } else {
                // Check errorType to determine error handling
                // QuotaExceeded: use short message for tooltip, keep detailed message for modal
                // TranslationError: use the specific error message from backend
                // GenericError: use fallback SERVER_BUSY message
                let tooltipText = response.shortMessage || "翻译失败"
                let errorMessage: string = ERROR_MESSAGES.SERVER_BUSY

                if (response.errorType === "QuotaExceeded") {
                    tooltipText = response.shortMessage || ERROR_MESSAGES.QUOTA_EXCEEDED_SHORT
                    errorMessage = response.error // Keep detailed message for modal
                } else if (response.errorType === "TranslationError") {
                    errorMessage = response.error
                }

                translationDisplay.updateTranslationResult(
                    anchorId,
                    {
                        status: "error",
                        text: tooltipText,
                        errorMessage: errorMessage,
                    },
                    displaySettings
                )
                logger.error("Fragment translation error:", response.error)
            }
        } catch (error) {
            translationDisplay.updateTranslationResult(
                anchorId,
                {
                    status: "error",
                    text: "翻译失败",
                    errorMessage: ERROR_MESSAGES.SERVER_BUSY,
                },
                displaySettings
            )
            logger.error("Fragment translation request failed:", error)
        }
    }

    // Detect overlapping translations BEFORE wrapping (collect IDs only)
    const preWrapOverlappingIds = translationOverlapDetector.detectOverlappingTranslations(range)

    // Show loading state with full context and refresh callback (this wraps the selection)
    const refreshCallback = async () => {
        logger.info("[Fragment Path] Refreshing translation for:", fragment)
        await performFragmentRequest(true)
    }
    anchorId = translationDisplay.showTranslationResult(
        range,
        fragment,
        {
            status: "loading",
            text: i18nModule.translate("modal.loading"),
            loadingVariant,
        },
        context,
        refreshCallback,
        "fragment", // Specify this is a fragment translation
        displaySettings
    )

    // After wrapping, remove ALL instances of pre-detected overlapping anchors by ID
    // This handles cases where a previous anchor was split and duplicated (nested clone + leftover)
    try {
        const toRemove = preWrapOverlappingIds.filter((id) => id !== anchorId)
        if (toRemove.length > 0) {
            logger.info("[Fragment Path] Removing overlapping translations after wrap:", toRemove)
            toRemove.forEach((id) => {
                while (document.getElementById(id)) {
                    translationDisplay.removeTranslationResult(id)
                }
            })
        }
    } catch (e) {
        logger.warn("[Fragment Path] Overlap cleanup after wrap failed:", e)
    }

    // Begin async language detection and then request translation
    await performFragmentRequest()
}