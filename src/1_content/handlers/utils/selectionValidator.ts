/**
 * Selection Validator Utility
 *
 * Centralizes validation logic for text selections to determine if translation should be triggered.
 */
import * as types from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as constants from "@/1_content/constants"
import * as domSanitizer from "@/1_content/utils/domSanitizer"
import * as editableElementDetector from "@/1_content/handlers/utils/editableElementDetector"
import * as tapWordDetector from "@/1_content/handlers/utils/tapWordDetector"
import * as translationDisplay from "@/1_content/ui/translationDisplayV2"

import { shouldTriggerTranslationAsync } from "@/1_content/utils/languageValidator"
const ELEMENT_NODE = 1
const SINGLE_WORD_WHITESPACE_REGEX = /\s/
const MAX_SINGLE_CLICK_WORD_LENGTH = 30 // Reasonable max length for a single word
const logger = loggerModule.createLogger("selectionValidator")

export type ValidationTrigger = "icon" | "doubleClickWord" | "doubleClickSentence"

export interface ValidationResult {
    isValid: boolean
    text: string
    range?: Range
    reason?: string
    shouldCleanup?: boolean // true if the caller should remove the icon/cancel UI
}

/**
 * Helper to check if source language matches target language (i.e. user's native language)
 */
async function isNativeLanguageAsync(text: string, targetLanguage: string, context?: string): Promise<boolean> {
    const shouldTrigger = await shouldTriggerTranslationAsync(text, targetLanguage, context)
    return !shouldTrigger
}

/**
 * Returns true only when `candidateRange` is fully contained by a single active translation range.
 * Partial overlap across one or more translations is intentionally allowed so the overlap cleanup
 * path can replace the old translations with the new selection.
 */
function isFullyContainedBySingleActiveTranslation(candidateRange: Range): boolean {
    const activeRanges = translationDisplay.getActiveRanges()

    for (const [, activeRange] of activeRanges) {
        if (rangeFullyContainsRange(activeRange, candidateRange)) {
            return true
        }
    }

    return false
}

function rangeFullyContainsRange(outerRange: Range, innerRange: Range): boolean {
    try {
        const startsBeforeOrAtInnerStart = outerRange.compareBoundaryPoints(Range.START_TO_START, innerRange) <= 0
        const endsAfterOrAtInnerEnd = outerRange.compareBoundaryPoints(Range.END_TO_END, innerRange) >= 0

        return startsBeforeOrAtInnerStart && endsAfterOrAtInnerEnd
    } catch {
        return false
    }
}

/**
 * Validates whether the current selection should trigger a translation action (icon or direct).
 *
 * @param selection - The current selection object
 * @param settings - The user settings
 * @param trigger - The type of trigger ('icon' or 'doubleClick')
 * @returns Promise<ValidationResult> object containing validity status, extracted text, and optional range/reason
 */
export async function validateSelectionAsync(
    selection: Selection | null,
    settings: types.UserSettings | null,
    trigger: ValidationTrigger
): Promise<ValidationResult> {
    // 1. Basic Selection Check
    if (!selection || selection.rangeCount === 0) {
        return { isValid: false, text: "", reason: "No valid selection", shouldCleanup: true }
    }

    // 2. Global Settings Check
    const enableTapWord = settings?.enableTapWord ?? true
    if (!enableTapWord) {
        return { isValid: false, text: "", reason: "Extension disabled via enableTapWord", shouldCleanup: true }
    }

    // 3. Trigger-specific Settings Check
    if (trigger === "icon") {
        const showIcon = settings?.showIcon ?? true
        if (!showIcon) {
            // Original logic: just return, don't explicitly remove icon (though often desirable, we stick to original)
            return { isValid: false, text: "", reason: "Icon disabled via settings", shouldCleanup: false }
        }
    } else if (trigger === "doubleClickWord") {
        const doubleClickTranslate = settings?.doubleClickTranslateV2 ?? true
        if (!doubleClickTranslate) {
            return { isValid: false, text: "", reason: "Double-click word translation disabled via settings", shouldCleanup: false }
        }
    } else if (trigger === "doubleClickSentence") {
        const sentenceModeEnabled = settings?.doubleClickSentenceTranslate ?? true
        if (!sentenceModeEnabled) {
            return { isValid: false, text: "", reason: "Double-click sentence translation disabled via settings", shouldCleanup: false }
        }
    }

    // 4. Text Extraction & Validation
    const range = selection.getRangeAt(0)
    const rawText = domSanitizer.getCleanTextFromRange(range)
    const selectedText = rawText.trim()

    if (selectedText.length === 0) {
        return { isValid: false, text: "", reason: "Empty selection", shouldCleanup: true }
    }

    // 5. Length Check
    if (selectedText.length > constants.MAX_SELECTION_LENGTH) {
        return {
            isValid: false,
            text: selectedText,
            reason: `Selection too long (${selectedText.length} chars)`,
            shouldCleanup: true,
        }
    }

    // 6. Contentless Check (Numeric, Symbols, Punctuation only)
    // Matches if the string consists entirely of Numbers, Whitespace, Punctuation, or Symbols
    if (/^[\d\s\p{P}\p{S}]+$/u.test(selectedText)) {
        return { isValid: false, text: selectedText, reason: "Contentless selection skipped", shouldCleanup: false }
    }

    // 7. Language Suppression Check
    // Always check for native language suppression for doubleClick (unless explicitly disabled in future)
    // For 'icon' trigger, we respect the suppressNativeLanguage setting (which might be false)
    // BUT user requirement says: "single-click and double-click, default closed under native text"
    
    const targetLang = settings?.targetLanguage || types.DEFAULT_USER_SETTINGS.targetLanguage
    // Use a larger radius (300) to capture headings and other elements on the page,
    // giving the suppress check a more representative sample of the page language.
    const contextText = domSanitizer.getSurroundingTextForDetection(range, 300)
    const suppressNativeLanguage = settings?.suppressNativeLanguage ?? types.DEFAULT_SUPPRESS_NATIVE_LANGUAGE

    // Force suppression for doubleClick trigger if it is native language
    if (trigger === "doubleClickWord" || trigger === "doubleClickSentence") {
        const isNative = await isNativeLanguageAsync(selectedText, targetLang, contextText)
        if (isNative) {
             return { isValid: false, text: selectedText, reason: "Double-click suppressed on native language", shouldCleanup: true }
        }
    } else if (suppressNativeLanguage) {
        // Standard suppression logic for icon trigger
        const shouldTrigger = await shouldTriggerTranslationAsync(selectedText, targetLang, contextText)
        if (!shouldTrigger) {
            return { isValid: false, text: selectedText, reason: "Suppressed by language detector", shouldCleanup: true }
        }
    }

    // 8. DOM/Element Checks
    const container = range.commonAncestorContainer
    const element = container.nodeType === ELEMENT_NODE ? (container as Element) : container.parentElement

    if (editableElementDetector.isEditableElement(element)) {
        return { isValid: false, text: selectedText, reason: "Selection inside editable element", shouldCleanup: true }
    }

    if (element?.closest(`.${constants.CSS_CLASSES.ICON}, .${constants.CSS_CLASSES.TOOLTIP}`)) {
        return { isValid: false, text: selectedText, reason: "Selection inside extension UI", shouldCleanup: false }
    }

    // V2: Block only when the new selection is fully contained by one existing translation range.
    // Partial overlap remains valid and will be handled by overlap cleanup during translation.
    if (isFullyContainedBySingleActiveTranslation(range)) {
        return { isValid: false, text: selectedText, reason: "Selection inside active translation", shouldCleanup: false }
    }

    return { isValid: true, text: selectedText, range, reason: "Valid selection", shouldCleanup: false }
}

export interface SingleClickValidationResult {
    isValid: boolean
    text: string
    range?: Range
    reason?: string
    shouldCleanup?: boolean
}

/**
 * Validates whether the current single click should trigger a translation.
 *
 * @param event - The MouseEvent object
 * @param settings - The user settings
 * @returns Promise<SingleClickValidationResult> object containing validity status, extracted text, and optional range/reason
 */
export async function validateSingleClickAsync(
    event: MouseEvent,
    settings: types.UserSettings | null
): Promise<SingleClickValidationResult> {
    // 0. Global & Feature Settings Check
    const enableTapWord = settings?.enableTapWord ?? true
    if (!enableTapWord) {
        return { isValid: false, text: "", reason: "Extension disabled via enableTapWord", shouldCleanup: false }
    }
    if (!settings?.singleClickTranslate) {
        return { isValid: false, text: "", reason: "Feature disabled", shouldCleanup: false }
    }

    // 1. Event Check
    if (event.button !== 0 || event.defaultPrevented) {
        return { isValid: false, text: "", reason: "Invalid event", shouldCleanup: false }
    }

    // 1.5. Modifier Key Check
    // If any modifier key is pressed, we should skip single-click translation.
    // This allows users to:
    // - Perform double-click sentence translation (which requires a modifier)
    // - Perform native browser actions (e.g. Cmd+Click, Shift+Click) without interference
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) {
        return { isValid: false, text: "", reason: "Modifier key pressed", shouldCleanup: false }
    }

    // 2. Interactive Element Check
    if (editableElementDetector.isInteractiveElement(event.target, event)) {
        return { isValid: false, text: "", reason: "Interactive element", shouldCleanup: false }
    }

    // 3. Extension UI Check
    const target = event.target as Element
    if (
        target &&
        (target.closest(`.${constants.CSS_CLASSES.ICON}`) ||
            target.closest(`.${constants.CSS_CLASSES.TOOLTIP}`) ||
            target.closest(`.${constants.CSS_CLASSES.MODAL}`) ||
            target.closest(`.${constants.CSS_CLASSES.MODAL_BACKDROP}`))
    ) {
        return { isValid: false, text: "", reason: "Extension UI element", shouldCleanup: false }
    }

    // V2: Check if click point falls inside an active translation Range (replaces V1 anchor check)
    if (translationDisplay.isPointInsideActiveTranslation(event.clientX, event.clientY)) {
        return { isValid: false, text: "", reason: "Click inside active translation", shouldCleanup: false }
    }

    // 4. Selection Check
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed) {
        return { isValid: false, text: "", reason: "Active selection present", shouldCleanup: false }
    }

    // 5. Range Extraction
    const range = tapWordDetector.getWordRangeFromPoint(event.clientX, event.clientY)
    if (!range) {
        return { isValid: false, text: "", reason: "No word range at point", shouldCleanup: false }
    }

    // 6. Text Validation
    const sanitizedText = domSanitizer.getCleanTextFromRange(range).trim()
    if (!sanitizedText || SINGLE_WORD_WHITESPACE_REGEX.test(sanitizedText)) {
        return { isValid: false, text: sanitizedText, reason: "Invalid text (empty or whitespace)", shouldCleanup: false }
    }

    if (sanitizedText.length > MAX_SINGLE_CLICK_WORD_LENGTH) {
        return { isValid: false, text: sanitizedText, reason: `Word too long (${sanitizedText.length} chars)`, shouldCleanup: false }
    }

    // 7. Contentless Check (Numeric, Symbols, Punctuation only)
    if (/^[\d\s\p{P}\p{S}]+$/u.test(sanitizedText)) {
        return { isValid: false, text: sanitizedText, reason: "Contentless selection skipped", shouldCleanup: false }
    }

    // 8. Language Suppression Check
    // Single-click respects the same suppressNativeLanguage setting as the icon trigger.
    // Double-click has its own always-on suppression (see validateIconTriggerSelection).
    const targetLang = settings?.targetLanguage || types.DEFAULT_USER_SETTINGS.targetLanguage
    // Use a larger radius (300) to capture headings and other elements on the page.
    const contextText = domSanitizer.getSurroundingTextForDetection(range, 300)
    const suppressNativeLanguage = settings?.suppressNativeLanguage ?? types.DEFAULT_SUPPRESS_NATIVE_LANGUAGE

    if (suppressNativeLanguage) {
        const isNative = await isNativeLanguageAsync(sanitizedText, targetLang, contextText)
        logger.debug("Single-click native-language check", {
            text: sanitizedText,
            targetLang,
            suppressNativeLanguage,
            contextLength: contextText.length,
            contextSnippet: contextText.substring(0, 80) + "...",
            isNative,
        })
        if (isNative) {
            return { isValid: false, text: sanitizedText, reason: "Single-click suppressed on native language", shouldCleanup: true }
        }
    }
    
    return { isValid: true, text: sanitizedText, range, reason: "Valid single click", shouldCleanup: true }
}
