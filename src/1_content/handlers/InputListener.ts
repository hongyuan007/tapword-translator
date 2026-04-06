/**
 * Input Listener
 *
 * Handles DOM events and translates user intent into pipeline calls.
 */

import * as loggerModule from "@/0_common/utils/logger"
import { AGENT_PANEL_ENABLED } from "@/0_common/constants"
import * as constants from "@/1_content/constants"
import * as contentIndex from "@/1_content/index"
import * as iconManager from "@/1_content/ui/iconManager"
import * as translationHitTesting from "@/1_content/ui/translationDisplayV2/hitTesting"
import { expandRangeToSentence } from "@/1_content/utils/contextExtractorV2"
import * as translationPipeline from "@/1_content/handlers/TranslationPipeline"
import { validateSelectionAsync, validateSingleClickAsync } from "@/1_content/handlers/utils/selectionValidator"
import * as rangeAdjusterModule from "@/1_content/handlers/utils/rangeAdjuster"
import * as contextExtractorModule from "@/1_content/utils/contextExtractorV2"
import * as domSanitizer from "@/1_content/utils/domSanitizer"

const logger = loggerModule.createLogger("selectionHandler")
const SINGLE_CLICK_TRIGGER_LABEL = "Single Click"
const SINGLE_CLICK_LOG_PREFIX = "[Single Click]"
const SIDEPANEL_OPEN_DELAY_MS = 300

/**
 * Build explain text payload from a selection range.
 * Reuses the same pattern as AgentPanelMessageHandler.handleGetSelectedText.
 */
function buildExplainPayload(range: Range): { text: string; contextText: string; blockText: string } | null {
    const { range: adjustedRange } = rangeAdjusterModule.adjustSelectionRange(range)
    const text = adjustedRange.toString()
    if (!text) return null

    const context = contextExtractorModule.extractContextV2(adjustedRange)

    const startBlock = domSanitizer.getClosestBlockAncestor(adjustedRange.startContainer)
    const endBlock = domSanitizer.getClosestBlockAncestor(adjustedRange.endContainer)
    const blockElement = startBlock === endBlock
        ? startBlock
        : domSanitizer.getClosestBlockAncestor(adjustedRange.commonAncestorContainer)
    const blockText = (blockElement.textContent?.trim() || "").replace(/\s+/g, " ").trim()

    return { text, contextText: context.currentSentence, blockText }
}

/**
 * Handle explain icon click — open sidepanel and send explain request.
 */
function handleExplainIconClick(range: Range): void {
    const payload = buildExplainPayload(range)
    if (!payload) return

    // Open the sidepanel first
    chrome.runtime.sendMessage({ type: "OPEN_SIDE_PANEL" }).catch(() => {
        logger.warn("Failed to send OPEN_SIDE_PANEL message")
    })

    // After a delay for the sidepanel to initialize, send the explain request
    setTimeout(() => {
        chrome.runtime.sendMessage({
            type: "EXPLAIN_TEXT_REQUEST",
            data: payload,
        }).catch(() => {
            logger.warn("Failed to send EXPLAIN_TEXT_REQUEST message")
        })
    }, SIDEPANEL_OPEN_DELAY_MS)

    // Clean up icons
    iconManager.removeTranslationIcon()
}

/**
 * Handle text selection on the page
 */
export async function handleTextSelection(): Promise<void> {
    const selection = window.getSelection()
    const settings = contentIndex.getCachedUserSettings()

    const validation = await validateSelectionAsync(selection, settings, "icon")

    if (!validation.isValid) {
        if (validation.shouldCleanup) {
            iconManager.removeTranslationIcon()
        }
        if (validation.reason) {
            logger.debug(`Selection validation failed: ${validation.reason}`)
        }
        return
    }

    const range = validation.range!

    // Create a click handler that captures the current selection and range.
    const onIconClick = (event: Event) => {
        event.stopPropagation()
        translationPipeline.handleIconClick(selection!, range)
    }

    // Get icon color from settings
    const iconColor = settings?.iconColor ?? "pink"

    // Show the icon
    iconManager.showTranslationIcon(range, onIconClick, iconColor)

    // Show explain icon alongside translation icon (feature-gated)
    if (AGENT_PANEL_ENABLED && settings?.enableChatAssistant !== false) {
        const onExplainClick = (event: Event) => {
            event.stopPropagation()
            handleExplainIconClick(range)
        }
        iconManager.showExplainIcon(range, onExplainClick)
    }
}

/**
 * Handle single-click to trigger word translation
 */
export async function handleSingleClick(event: MouseEvent): Promise<void> {
    const settings = contentIndex.getCachedUserSettings()
    const validation = await validateSingleClickAsync(event, settings)

    if (!validation.isValid) {
        if (validation.reason) {
            logger.debug(`${SINGLE_CLICK_LOG_PREFIX} Skipped: ${validation.reason}`)
        }
        return
    }

    iconManager.removeTranslationIcon()
    translationHitTesting.cancelPendingTranslationClick()

    await translationPipeline.triggerTranslationForRange(validation.range!, SINGLE_CLICK_TRIGGER_LABEL, "text")
}

/**
 * Handle double-click to trigger direct translation
 */
export async function handleDoubleClick(event: MouseEvent): Promise<void> {
    const settings = contentIndex.getCachedUserSettings()
    const selection = window.getSelection()

    // 1. Determine Intent (Sentence vs Word)
    const sentenceModeEnabled = settings?.doubleClickSentenceTranslate ?? true
    const triggerKey = settings?.doubleClickSentenceTriggerKey ?? "alt"
    let isSentenceMode = false

    if (sentenceModeEnabled) {
        if (triggerKey === "meta") isSentenceMode = event.metaKey
        else if (triggerKey === "option" || triggerKey === "alt") isSentenceMode = event.altKey
        else if (triggerKey === "ctrl") isSentenceMode = event.ctrlKey
    }

    // 2. Validate based on intent
    // If it's sentence mode, we validate for "doubleClickSentence" (which might bypass some word-specific checks if needed, but currently shares logic)
    // If it's word mode, we validate for "doubleClickWord"
    // For now, we reuse "doubleClick" but pass the intent via settings check inside validator or just check here.
    
    const validationTrigger = isSentenceMode ? "doubleClickSentence" : "doubleClickWord"
    const validation = await validateSelectionAsync(selection, settings, validationTrigger)

    if (!validation.isValid) {
        if (validation.shouldCleanup) {
            iconManager.removeTranslationIcon()
        }
        if (validation.reason) {
            logger.debug(`Double-click (${validationTrigger}) validation failed: ${validation.reason}`)
        }
        return
    }

    // Must remove icon if proceeding (double click started)
    iconManager.removeTranslationIcon()

    let range = validation.range!

    if (isSentenceMode) {
        logger.info(`Modifier key (${triggerKey}) pressed, expanding selection to full sentence.`)
        range = expandRangeToSentence(range)
    }

    // Clear the selection to remove the browser's native highlight
    if (selection) {
        selection.removeAllRanges()
    }

    const baseLabel = isSentenceMode ? "Double Click (Sentence)" : "Double Click"
    await translationPipeline.triggerTranslationWithSplit(range, baseLabel)
}

/**
 * Handle clicks outside selection to hide icon
 */
export function handleDocumentClick(event: Event): void {
    const target = event.target as Element

    // Don't hide if clicking on our icon or tooltip
    if (target.closest(`.${constants.CSS_CLASSES.ICON}`) || target.closest(`.${constants.CSS_CLASSES.EXPLAIN_ICON}`) || target.closest(`.${constants.CSS_CLASSES.TOOLTIP}`)) {
        return
    }

    // Hide icon on outside clicks
    iconManager.removeTranslationIcon()
}
