/**
 * Translation Detail Modal 翻译详情页弹窗
 *
 * Displays a detailed modal when user clicks on translated text anchor.
 * Shows word, translation, original sentence, sentence translation, and dictionary content.
 */

import type { SpeechSynthesisResponseMessage } from "@/0_common/types"
import { APP_EDITION } from "@/0_common/constants"
import * as loggerModule from "@/0_common/utils/logger"
import * as constants from "@/1_content/constants"
import * as contentIndex from "@/1_content/index"
import * as modalTemplates from "@/1_content/ui/modalTemplates"
import * as toastNotification from "@/1_content/ui/toastNotification"
import * as languageDetector from "@/1_content/utils/languageDetector"
import { ModalPositioner } from "@/1_content/utils/modalPositioner"
import { ModalPositionerV2 } from "@/1_content/utils/modalPositionerV2"
import * as translationDisplay from "@/1_content/ui/translationDisplayV2"
import * as versionStatus from "@/1_content/utils/versionStatus"

// Inject modal stylesheet into Shadow DOM to avoid host CSS leakage
import modalCssRaw from "@/1_content/resources/modal.css?raw"

const logger = loggerModule.createLogger("translationModal")

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Translation status
 */
export type TranslationStatus = "loading" | "success" | "error"

/**
 * Translation type - distinguishes between word and fragment translations
 */
export type TranslationType = "word" | "fragment"

/**
 * Translation detail data for modal display
 */
export interface TranslationDetailData {
    /** Translation status: loading, success, or error */
    status: TranslationStatus
    /** Translation type: word or fragment */
    translationType: TranslationType
    /** The text (word or fragment) that was translated */
    text: string
    /** Translation of the text */
    translation: string
    /** Original sentence containing the word (only for word translations) */
    originalSentence?: string
    /** Translation of the entire sentence (only for word translations) */
    sentenceTranslation?: string
    /** Text before the word in the same sentence (only for word translations) */
    leadingText?: string
    /** Text after the word in the same sentence (only for word translations) */
    trailingText?: string
    /** Error message (only present when status is 'error') */
    errorMessage?: string
    /** Chinese dictionary definition (only for English word translations) */
    chineseDefinition?: string
    /** English dictionary definition (only for English word translations) */
    englishDefinition?: string
    /** Target language dictionary definition (only when FreeDict dictionary is available) */
    targetDefinition?: string
    /** Target language code for translation (e.g., "zh", "ja", "es") */
    targetLanguage?: string
    /** Lemma - base form of the word (e.g., "running" → "run") (only for word translations) */
    lemma?: string | null
    /** IPA phonetic transcription (only for English word translations) */
    phonetic?: string
    /** Phonetic transcription for the lemma (base form) (only when word was lemmatized) */
    lemmaPhonetic?: string
    /** Detected source language to be reused by speech synthesis (avoid re-detection errors) */
    sourceLanguage?: string
    /** Callback function to handle deletion */
    onDelete?: () => void
    /** Callback function to handle refresh/retranslation */
    onRefresh?: () => void
}

// ============================================================================
// State Management
// ============================================================================



/**
 * Current modal content container (for dynamic updates)
 */
let activeModalContainer: HTMLElement | null = null
/** Host element that owns the shadow root for the modal (for outside-click detection and cleanup) */
let activeModalHost: HTMLElement | null = null

/**
 * ID of the anchor that the current modal is displaying
 * Used to automatically refresh modal when translation completes
 */
let activeModalAnchorId: string | null = null

/**
 * Dragging state for the modal
 */
let isDragging = false
let initialX = 0
let initialY = 0
let offsetX = 0
let offsetY = 0

// ============================================================================
// Modal Creation and Display
// ============================================================================

/**
 * Show translation detail modal
 *
 * @param data - Translation detail data to display
 * @param anchorElement - The anchor element that triggered the modal (for positioning)
 * @param anchorId - Optional anchor ID to enable automatic modal updates when translation completes
 *
 * @example
 * ```typescript
 * const anchorElement = document.getElementById('translation-anchor-0');
 * showTranslationModal({
 *     status: 'success',
 *     word: 'light',
 *     wordTranslation: '光线',
 *     originalSentence: 'The room was filled with natural light.',
 *     sentenceTranslation: '房间里充满了自然光线。',
 *     dictionaryContent: 'noun: visible electromagnetic radiation...'
 * }, anchorElement, 'translation-anchor-0');
 * ```
 */
export async function showTranslationModal(data: TranslationDetailData, anchorSource: HTMLElement | Range | null, anchorId?: string): Promise<void> {
    try {
        // Close existing modal if any
        closeTranslationModal()

        // Fetch version status (with 30-min cache)
        const versionStatusData = await versionStatus.getVersionStatus()
        const showUpdateLabel = versionStatusData?.needsUpdate ?? false

        // Create Shadow Host and Shadow Root with isolated stylesheet
        const { host, shadowRoot } = createShadowHost()
        // Create modal structure inside shadow
        const modal = createModalElement(data, showUpdateLabel)
        // Append stylesheet first to ensure styles apply before layout/paint
        const styleEl = document.createElement("style")
        styleEl.textContent = modalCssRaw
        shadowRoot.appendChild(styleEl)
        // Append modal into shadow
        shadowRoot.appendChild(modal)
        // Add host to document
        document.body.appendChild(host)

        // Store references
        activeModalAnchorId = anchorId || null
        activeModalHost = host

        // Position the modal relative to the anchor source (HTMLElement or Range)
        if (anchorSource) {
            positionModal(modal, anchorSource)
        }

        // Add dragging functionality
        makeModalDraggable(modal)

        // Attach click handler to update label if present and version status available
        if (showUpdateLabel && versionStatusData?.websiteUrl) {
            attachUpdateLabelClickHandler(modal, versionStatusData.websiteUrl)
        }

        // Trigger fade-in animation
        requestAnimationFrame(() => {
            modal.classList.add("visible")

            // Check user setting for auto-play audio
            const settings = contentIndex.getCachedUserSettings()
            const autoPlayAudio = settings?.autoPlayAudio ?? true // Default to true if settings not loaded

            // Only auto-play audio when translation is successful
            if (data.status === "success" && data.translationType === "word" && data.text && autoPlayAudio) {
                // Create a dummy event object as handleSpeakClick expects one
                const dummyEvent = new MouseEvent("click", { bubbles: true, cancelable: true })
                // Pass isAutoPlay=true to suppress error toasts for auto-play, and sourceLanguage for accurate detection
                handleSpeakClick(dummyEvent, data.text, true, data.sourceLanguage)
            }
        }) // Enable scroll-to-close while modal is visible
        enableScrollAutoClose()

        logger.info("Translation detail modal displayed", { anchorId })
    } catch (error) {
        logger.error("Error showing translation modal:", error)
    }
}

/**
 * Close the translation detail modal
 */
export function closeTranslationModal(): void {
    // Disable scroll-to-close listeners immediately
    disableScrollAutoClose()

    if (!activeModalContainer && !activeModalHost) {
        return
    }

    // Stop speech playback in background
    chrome.runtime.sendMessage({ type: "SPEECH_STOP_REQUEST" }, () => {
        if (chrome.runtime.lastError) {
            logger.warn("Failed to send SPEECH_STOP_REQUEST:", chrome.runtime.lastError)
        }
    })

    const modalToClose = activeModalContainer
    const hostToRemove = activeModalHost
    // Immediately clear the global references to prevent race conditions
    activeModalContainer = null
    activeModalAnchorId = null
    activeModalHost = null

    // Trigger fade-out animation
    if (modalToClose) {
        modalToClose.classList.remove("visible")
    }

    // Remove from DOM after animation. The closure now captures `modalToClose`
    // and does not depend on the global `activeModalContainer`.
    setTimeout(() => {
        try {
            if (hostToRemove) {
                hostToRemove.remove()
            } else if (modalToClose) {
                modalToClose.remove()
            }
        } catch {}
    }, 200) // Match CSS transition duration

    logger.info("Translation detail modal closed")
}

/**
 * Update the translation detail modal content
 *
 * Dynamically updates the modal content without closing/reopening.
 * Useful for updating from loading state to success/error state.
 *
 * @param data - New translation detail data to display
 *
 * @example
 * ```typescript
 * // Show loading state first
 * showTranslationModal({
 *     status: 'loading',
 *     word: 'light',
 *     wordTranslation: ''
 * });
 *
 * // Later update with success state
 * updateTranslationModal({
 *     status: 'success',
 *     word: 'light',
 *     wordTranslation: '光线',
 *     sentenceTranslation: '房间里充满了自然光线。'
 * });
 * ```
 */
export async function updateTranslationModal(data: TranslationDetailData): Promise<void> {
    if (!activeModalContainer) {
        logger.warn("No active modal to update")
        return
    }

    try {
        // Fetch version status for update label
        const versionStatusData = await versionStatus.getVersionStatus()
        const showUpdateLabel = versionStatusData?.needsUpdate ?? false

        // Update content with new template
        activeModalContainer.innerHTML = modalTemplates.renderModalContentTemplate(data, showUpdateLabel)

        // Reattach action button listeners after content update
        attachActionButtonListeners(activeModalContainer, data)

        // Reattach update label click handler if needed
        if (showUpdateLabel && versionStatusData?.websiteUrl) {
            attachUpdateLabelClickHandler(activeModalContainer, versionStatusData.websiteUrl)
        }

        logger.info("Translation modal content updated", data.status)
    } catch (error) {
        logger.error("Error updating translation modal:", error)
    }
}

/**
 * Get the anchor ID of the currently displayed modal
 *
 * @returns The anchor ID if a modal is open, null otherwise
 */
export function getActiveModalAnchorId(): string | null {
    return activeModalAnchorId
}

/**
 * Attach click handlers to update labels
 */
function attachUpdateLabelClickHandler(modalContainer: HTMLElement, websiteUrl: string): void {
    const updateLabels = modalContainer.querySelectorAll(".ai-translator-modal-update-label")
    updateLabels.forEach((label) => {
        label.addEventListener("click", (e) => {
            e.preventDefault()
            e.stopPropagation()
            // Open website URL in new tab
            const url = websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`
            window.open(url, "_blank")
            logger.info("Update label clicked, opening:", url)
        })
    })
}

// ============================================================================
// Modal Element Creation
// ============================================================================

/**
 * Placeholder handler for speak button
 * @param event - The event that triggered the speech
 * @param text - The text to speak
 * @param isAutoPlay - Whether this is auto-play (true) or user-triggered (false). Auto-play errors are silent.
 */
async function handleSpeakClick(event: Event, text: string, isAutoPlay: boolean = false, languageOverride?: string): Promise<void> {
    event.stopPropagation()
    logger.info("Speak button clicked - requesting speech synthesis for:", text, { isAutoPlay, languageOverride })

    if (!text) {
        logger.warn("No text to speak.")
        return
    }

    // Prefer provided language from earlier detection (e.g., original sentence).
    // Only if missing, optionally detect as a fallback to keep previous behavior in rare cases.
    const detectedLanguage = languageOverride || (await languageDetector.detectSourceLanguageAsync(text)).lang
    logger.info(`[SpeechSynthesis] Using language for text "${text}": ${detectedLanguage}`)

    chrome.runtime.sendMessage(
        {
            type: "SPEECH_SYNTHESIS_REQUEST",
            data: {
                text: text,
                language: detectedLanguage,
            },
        },
        (response: SpeechSynthesisResponseMessage) => {
            if (chrome.runtime.lastError) {
                logger.error("Error sending speech synthesis message:", chrome.runtime.lastError)
                // Only show toast for user-triggered speech, not auto-play
                if (!isAutoPlay) {
                    toastNotification.showToast("语音播放失败", "error", activeModalContainer || undefined)
                }
                return
            }

            if (response.success) {
                logger.info("Speech synthesis started in background")
            } else {
                // Handle different error types
                let errorMessage = "语音播放失败, 请稍后再试"

                if (response.errorType === "QuotaExceeded") {
                    errorMessage = response.error
                }

                logger.error("Speech synthesis failed:", response.error)
                // Only show toast for user-triggered speech, not auto-play
                if (!isAutoPlay) {
                    toastNotification.showToast(errorMessage, "error", activeModalContainer || undefined)
                }
            }
        }
    )
}

/**
 * Handler for delete button.
 * Executes the onDelete callback and closes the modal.
 * @param event - The click event.
 * @param onDelete - The callback function to execute.
 */
function handleDeleteClick(event: Event, onDelete?: () => void): void {
    event.stopPropagation()
    logger.info("Delete button clicked")

    if (onDelete) {
        onDelete()
    }

    closeTranslationModal()
}

/**
 * Handler for refresh button.
 * Updates modal to loading state and executes the onRefresh callback.
 * @param event - The click event.
 * @param data - The translation data containing the onRefresh callback.
 */
function handleRefreshClick(event: Event, data: TranslationDetailData): void {
    event.stopPropagation()
    logger.info("Refresh button clicked - retranslating")

    // Update modal to loading state
    updateTranslationModal({
        ...data,
        status: "loading",
        translation: "",
        sentenceTranslation: undefined,
        errorMessage: undefined,
        chineseDefinition: undefined,
        englishDefinition: undefined,
        lemma: undefined,
        phonetic: undefined,
        lemmaPhonetic: undefined,
    })

    // Execute refresh callback if provided
    if (data.onRefresh) {
        data.onRefresh()
    }
}

/**
 * Attach event listeners to action buttons
 */
function attachActionButtonListeners(modalContainer: HTMLElement, data: TranslationDetailData): void {
    // Find all action buttons
    const speakBtn = modalContainer.querySelector(".ai-translator-speak-btn")
    const speakOriginalBtn = modalContainer.querySelector(".ai-translator-speak-original-btn")
    const speakSentenceBtn = modalContainer.querySelector(".ai-translator-speak-sentence-btn")
    const speakLemmaBtn = modalContainer.querySelector(".ai-translator-speak-lemma-btn")
    const deleteBtn = modalContainer.querySelector(".ai-translator-delete-btn")
    const refreshBtn = modalContainer.querySelector(".ai-translator-refresh-btn")
    const closeButton = modalContainer.querySelector(".ai-translator-modal-close")

    if (closeButton) {
        closeButton.addEventListener("click", closeTranslationModal)
    }

    // Attach event listeners
    if (speakBtn) {
        const textToSpeak = data.text
        speakBtn.addEventListener("click", (e) => handleSpeakClick(e, textToSpeak, false, data.sourceLanguage))
    }
    if (speakOriginalBtn) {
        const textToSpeak = data.translationType === "word" ? data.originalSentence || data.text : data.text
        speakOriginalBtn.addEventListener("click", (e) => handleSpeakClick(e, textToSpeak, false, data.sourceLanguage))
    }
    if (speakSentenceBtn) {
        const textToSpeak = `${data.leadingText || ""}${data.text}${data.trailingText || ""}`
        speakSentenceBtn.addEventListener("click", (e) => handleSpeakClick(e, textToSpeak, false, data.sourceLanguage))
    }
    if (speakLemmaBtn && data.lemma) {
        speakLemmaBtn.addEventListener("click", (e) => handleSpeakClick(e, data.lemma || "", false, data.sourceLanguage))
    }
    if (deleteBtn) {
        deleteBtn.addEventListener("click", (e) => handleDeleteClick(e, data.onDelete))
    }
    if (refreshBtn) {
        refreshBtn.addEventListener("click", (e) => handleRefreshClick(e, data))
    }

    logger.info("Action button listeners attached")
}

/**
 * Create the modal DOM element with all content
 */
function createModalElement(data: TranslationDetailData, showUpdateLabel: boolean = false): HTMLElement {
    // Create modal container
    const modalContainer = document.createElement("div")
    modalContainer.className = constants.CSS_CLASSES.MODAL
    modalContainer.setAttribute("data-app-edition", APP_EDITION)

    // Add a class based on the translation type for specific styling
    if (data.translationType === "word") {
        modalContainer.classList.add("translation-type--word")
    } else if (data.translationType === "fragment") {
        // Mark fragment type for positioning logic
        modalContainer.classList.add("translation-type--fragment")
    }

    // Render modal HTML from template (includes close button)
    modalContainer.innerHTML = modalTemplates.renderModalContentTemplate(data, showUpdateLabel)

    // Store content reference for updates (the entire container in this case)
    activeModalContainer = modalContainer

    // Attach action button listeners
    attachActionButtonListeners(modalContainer, data)

    return modalContainer
}

// ============================================================================
// Modal Dragging
// ============================================================================

/**
 * Make the modal draggable
 */
function makeModalDraggable(modal: HTMLElement): void {
    modal.addEventListener("mousedown", onDragStart)
}

/**
 * Handle mouse down event to start dragging
 */
function onDragStart(e: MouseEvent): void {
    // Prevent dragging when clicking on buttons or other interactive elements
    const target = e.target as HTMLElement
    if (target.closest("button, a, input, textarea, select")) {
        return
    }

    if (!activeModalContainer) return

    isDragging = true
    // Use viewport coordinates for fixed positioning
    initialX = e.clientX - offsetX
    initialY = e.clientY - offsetY

    // Add listeners for dragging and stopping
    document.addEventListener("mousemove", onDragging)
    document.addEventListener("mouseup", onDragEnd)

    // Style changes for dragging state
    if (activeModalContainer) {
        activeModalContainer.style.cursor = "grabbing"
        activeModalContainer.style.userSelect = "none"
    }
}

/**
 * Handle mouse move event to drag the modal
 */
function onDragging(e: MouseEvent): void {
    if (!isDragging || !activeModalContainer) return

    e.preventDefault()

    // Calculate new position in viewport coordinates
    const newX = e.clientX - initialX
    const newY = e.clientY - initialY

    offsetX = newX
    offsetY = newY

    // Update modal position (fixed positioning uses viewport coordinates)
    activeModalContainer.style.left = `${newX}px`
    activeModalContainer.style.top = `${newY}px`
}

/**
 * Handle mouse up event to stop dragging
 */
function onDragEnd(): void {
    if (!activeModalContainer) return

    isDragging = false

    // Remove listeners
    document.removeEventListener("mousemove", onDragging)
    document.removeEventListener("mouseup", onDragEnd)

    // Restore styles
    activeModalContainer.style.cursor = "default"
    activeModalContainer.style.userSelect = ""
}

// ============================================================================
// Modal Positioning
// ============================================================================

// Position type now provided by ModalPositioner helper

/**
 * Calculate and apply optimal position for the modal relative to anchor element
 * Priority: bottom-right > bottom-left > top-right > top-left
 *
 * @param modalContainer - The modal container element
 * @param anchorSource - The anchor element or Range to position relative to
 */
function positionModal(modalContainer: HTMLElement, anchorSource: HTMLElement | Range): void {
    const modalRect = modalContainer.getBoundingClientRect()
    const isFragment = modalContainer.classList.contains("translation-type--fragment")
    const translationType = isFragment ? "fragment" : "word" as const

    // V2: use ModalPositionerV2 for Range-based positioning
    const res = anchorSource instanceof Range
        ? ModalPositionerV2.compute(anchorSource, modalRect, translationType)
        : ModalPositioner.compute(anchorSource, modalRect, translationType)

    // Use fixed positioning (viewport space) instead of absolute (document space)
    // This makes the modal stay fixed relative to viewport during scroll
    modalContainer.style.position = "fixed"
    modalContainer.style.left = `${res.left}px`
    modalContainer.style.top = `${res.top}px`

    // Initialize drag offsets in viewport coordinates
    offsetX = res.left
    offsetY = res.top

    logger.info("Modal positioned", { position: res.position, left: res.left, top: res.top, modalRect })
}

// ============================================================================
// Shadow DOM Helpers
// ============================================================================

function createShadowHost(): { host: HTMLElement; shadowRoot: ShadowRoot } {
    const host = document.createElement("div")
    // Keep host inert and style-neutral; child modal uses fixed positioning and its own z-index
    host.style.all = "initial"
    const shadowRoot = host.attachShadow({ mode: "open" })
    return { host, shadowRoot }
}

// ============================================================================
// Keyboard Event Handler
// ============================================================================

/**
 * Handle ESC key to close modal
 */
function handleKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && activeModalContainer) {
        closeTranslationModal()
    }
}

/**
 * Handle click outside modal to close
 */
function handleOutsideClick(event: MouseEvent): void {
    if (!activeModalContainer && !activeModalHost) {
        return
    }

    const target = event.target as Node

    // V2: Check if click landed inside an active translation Range (replaces V1 anchor check)
    if (translationDisplay.isPointInsideActiveTranslation(event.clientX, event.clientY)) {
        return
    }

    // Shadow DOM aware: consider composedPath to detect clicks within shadow tree
    const path = (event.composedPath && event.composedPath()) || []
    const clickedInsideModal = activeModalContainer ? activeModalContainer.contains(target) || path.includes(activeModalContainer) : false
    const clickedInsideHost = activeModalHost ? activeModalHost.contains(target) || path.includes(activeModalHost) : false
    if (clickedInsideModal || clickedInsideHost) {
        return
    }

    closeTranslationModal()
}

/**
 * 暂时不启用
 * Handle page scroll to close modal
 */
// function handleScroll(): void {
//     if (activeModal) {
//         closeTranslationModal()
//     }
// }

// Add global keyboard listener
document.addEventListener("keydown", handleKeydown)

// Add global click listener for closing modal on outside click
document.addEventListener("click", handleOutsideClick, true)

// Add global scroll listener for closing modal on page scroll
// document.addEventListener("scroll", handleScroll, true)

// ============================================================================
// Scroll-to-Close (Auto dismiss on continuous scroll)
// ============================================================================

/**
 * Auto-close when user continuously scrolls a small distance
 * - Uses both wheel deltas and window scroll deltas
 * - Ignores scrolling inside the modal content itself
 */
const SCROLL_CLOSE_THRESHOLD_PX = 100 // Small but not too small (~1-2 lines typical page scroll)
const SCROLL_RESET_MS = 300 // Reset accumulation if no scroll within this window
const SCROLL_CAPTURE = true

let scrollAccumPx = 0
let scrollResetTimer: number | null = null
let scrollCloseEnabled = false
let lastWindowScrollX = 0
let lastWindowScrollY = 0

function resetScrollAccumSoon(): void {
    if (scrollResetTimer) window.clearTimeout(scrollResetTimer)
    scrollResetTimer = window.setTimeout(() => {
        scrollAccumPx = 0
        scrollResetTimer = null
    }, SCROLL_RESET_MS)
}

function isEventInsideModal(evt: Event): boolean {
    if (!activeModalContainer && !activeModalHost) return false
    const target = evt.target as Node
    const path = (evt as any).composedPath ? ((evt as any).composedPath() as EventTarget[]) : []
    const insideContainer = activeModalContainer ? activeModalContainer.contains(target) || path.includes(activeModalContainer) : false
    const insideHost = activeModalHost ? activeModalHost.contains(target) || path.includes(activeModalHost) : false
    return insideContainer || insideHost
}

function maybeCloseOnAccumulatedScroll(): void {
    if (!activeModalContainer) return
    if (scrollAccumPx >= SCROLL_CLOSE_THRESHOLD_PX) {
        closeTranslationModal()
    }
}

function handleWheelForClose(e: WheelEvent): void {
    if (!activeModalContainer) return
    // Ignore wheel interactions that originate within the modal
    if (isEventInsideModal(e)) return

    const delta = Math.abs(e.deltaY) + Math.abs(e.deltaX) * 0.3
    if (delta > 0) {
        scrollAccumPx += delta
        resetScrollAccumSoon()
        maybeCloseOnAccumulatedScroll()
    }
}

function handleScrollForClose(e: Event): void {
    if (!activeModalContainer) return
    // If the scroll originated inside modal (its own inner scroll), ignore
    if (isEventInsideModal(e)) return

    const currX = window.scrollX || document.documentElement.scrollLeft || 0
    const currY = window.scrollY || document.documentElement.scrollTop || 0
    const delta = Math.abs(currY - lastWindowScrollY) + Math.abs(currX - lastWindowScrollX)
    lastWindowScrollX = currX
    lastWindowScrollY = currY
    if (delta > 0) {
        scrollAccumPx += delta
        resetScrollAccumSoon()
        maybeCloseOnAccumulatedScroll()
    }
}

function enableScrollAutoClose(): void {
    if (scrollCloseEnabled) return
    scrollCloseEnabled = true
    scrollAccumPx = 0
    lastWindowScrollX = window.scrollX || 0
    lastWindowScrollY = window.scrollY || 0
    document.addEventListener("wheel", handleWheelForClose, { passive: true, capture: SCROLL_CAPTURE })
    window.addEventListener("scroll", handleScrollForClose, { passive: true, capture: SCROLL_CAPTURE })
}

function disableScrollAutoClose(): void {
    if (!scrollCloseEnabled) return
    scrollCloseEnabled = false
    document.removeEventListener("wheel", handleWheelForClose as EventListener, { capture: SCROLL_CAPTURE } as any)
    window.removeEventListener("scroll", handleScrollForClose as EventListener, { capture: SCROLL_CAPTURE } as any)
    if (scrollResetTimer) {
        window.clearTimeout(scrollResetTimer)
        scrollResetTimer = null
    }
    scrollAccumPx = 0
}
