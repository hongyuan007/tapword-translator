/**
 * @file tooltipRenderer.ts
 * DOM creation and content-rendering functions for individual tooltip elements.
 *
 * V2 variant: removes the `anchor` parameter dependency from `renderTooltipContent()`.
 * Style calculation uses only `originalElement`; `anchor` is always passed as `null`.
 *
 * All functions here operate on a single `HTMLElement` instance passed as an argument.
 * They do not own or mutate any shared state maps; that responsibility belongs to the coordinator.
 */

import * as contentIndex from "@/1_content/index"
import * as constants from "@/1_content/constants"
import * as translationFontSizeModule from "@/0_common/constants/translationFontSize"
import * as styleCalculator from "@/1_content/utils/styleCalculator"
import * as loggerModule from "@/0_common/utils/logger"
import type { DisplayUserSettings, TranslationState } from "./types"

const logger = loggerModule.createLogger("1_content/ui/translationDisplayV2/tooltipRenderer")

function describeElement(element: HTMLElement | null | undefined): string {
    if (!element) {
        return "null"
    }

    const idPart = element.id ? `#${element.id}` : ""
    const classList = Array.from(element.classList).slice(0, 3)
    const classPart = classList.length > 0 ? `.${classList.join(".")}` : ""
    const textSnippet = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)
    const textPart = textSnippet ? ` text="${textSnippet}"` : ""

    return `${element.tagName.toLowerCase()}${idPart}${classPart}${textPart}`
}

function formatStyleValue(value: string | null | undefined): string {
    return value && value.trim().length > 0 ? value : "(empty)"
}

// ============================================================================
// Font & Style Helpers
// ============================================================================

/**
 * Resolve the minimum tooltip font size in pixels.
 * Reads the preset from `userSettings` first, falling back to cached global settings.
 *
 * @param userSettings - Optional per-call overrides for display settings.
 * @returns Minimum font size in pixels.
 */
export function resolveMinFontSizePx(userSettings?: DisplayUserSettings): number {
    const cachedSettings = contentIndex.getCachedUserSettings()
    const resolved = translationFontSizeModule.resolveTranslationFontSize(
        userSettings?.translationFontSizePreset ?? cachedSettings?.translationFontSizePreset
    )
    return resolved.px
}

// ============================================================================
// Tooltip Element Factory
// ============================================================================

/**
 * Create a bare tooltip `<div>` with the base CSS class applied.
 *
 * @returns A detached `HTMLElement` ready to be styled and appended to `document.body`.
 */
export function createTooltipElement(): HTMLElement {
    const tooltip = document.createElement("div")
    tooltip.className = constants.CSS_CLASSES.TOOLTIP

    const content = document.createElement("div")
    content.className = "ai-translator-tooltip-content"
    tooltip.appendChild(content)

    return tooltip
}

function getTooltipContentElement(tooltip: HTMLElement): HTMLElement {
    let content = tooltip.querySelector<HTMLElement>(".ai-translator-tooltip-content")
    if (!content) {
        content = document.createElement("div")
        content.className = "ai-translator-tooltip-content"
        tooltip.appendChild(content)
    }
    return content
}

/**
 * Copy visual style properties (font, color) from one tooltip element to another.
 * Used when cloning segments for multi-line selections to keep them visually consistent.
 *
 * @param source - The reference tooltip element.
 * @param target - The tooltip element to receive the copied styles.
 */
export function syncTooltipStyles(source: HTMLElement, target: HTMLElement): void {
    target.style.fontSize = source.style.fontSize
    target.style.color = source.style.color
    target.style.fontFamily = source.style.fontFamily
    target.style.fontWeight = source.style.fontWeight

    const sourceContent = getTooltipContentElement(source)
    const targetContent = getTooltipContentElement(target)
    targetContent.style.color = sourceContent.style.color
    targetContent.style.fontFamily = sourceContent.style.fontFamily
    targetContent.style.fontWeight = sourceContent.style.fontWeight
}

// ============================================================================
// Truncation Check
// ============================================================================

/**
 * Add or remove the `is-truncated` CSS class based on whether the element's content
 * overflows its rendered width. Called after layout to enable the CSS fade-out mask.
 *
 * @param element - The tooltip element to inspect.
 * @param bufferPx - Pixel tolerance to avoid false positives from sub-pixel rounding.
 */
export function checkTruncation(element: HTMLElement, bufferPx: number = 1): void {
    if (element.scrollWidth > element.clientWidth + bufferPx) {
        element.classList.add("is-truncated")
    } else {
        element.classList.remove("is-truncated")
    }
}

/**
 * Set the visible text content of a tooltip segment.
 * Skips updates for spinner-variant tooltips (which use a custom icon layout).
 * Schedules a truncation check via `requestAnimationFrame` to run after layout.
 *
 * @param tooltip - The tooltip element to update.
 * @param rawText - The translation text to display.
 * @param _maxWidthPx - Reserved for future clamping; CSS overflow currently handles limits.
 * @param _isLastLine - Reserved; context for potential future per-line logic.
 */
export function setTooltipText(tooltip: HTMLElement, rawText: string, _maxWidthPx: number, _isLastLine: boolean): void {
    // Spinner variant stores its own DOM structure; do not overwrite.
    if (tooltip.dataset.loadingVariant === "spinner") {
        return
    }

    // Cap text length as a safety guard; CSS fade mask handles visual overflow gracefully.
    const MAX_TEXT_LENGTH = 200
    const textToSet = rawText.length > MAX_TEXT_LENGTH ? rawText.slice(0, MAX_TEXT_LENGTH) : rawText
    const content = getTooltipContentElement(tooltip)
    content.textContent = textToSet

    requestAnimationFrame(() => {
        checkTruncation(tooltip)
    })
}

/**
 * Shift the translation text vertically inside the tooltip without moving the underline.
 *
 * @param tooltip - Tooltip root element containing the underline and content container.
 * @param offsetPx - Top offset in pixels applied to the content container.
 */
export function setTooltipContentOffset(tooltip: HTMLElement, offsetPx: number): void {
    const content = getTooltipContentElement(tooltip)
    content.style.marginTop = `${Math.max(0, offsetPx)}px`
}

/**
 * Add configurable blank space below the translation text.
 *
 * @param tooltip - Tooltip root element containing the content container.
 * @param spacingPx - Bottom spacing in pixels.
 */
export function setTooltipBottomSpacing(tooltip: HTMLElement, spacingPx: number): void {
    const content = getTooltipContentElement(tooltip)
    content.style.paddingBottom = `${Math.max(0, spacingPx)}px`
}

// ============================================================================
// Spinner
// ============================================================================

let spinnerStylesInjected = false

/**
 * Inject the spinner keyframe animation into `<head>` once per page load.
 * Subsequent calls are no-ops due to the `spinnerStylesInjected` guard.
 */
export function ensureSpinnerStyles(): void {
    if (spinnerStylesInjected) return
    const style = document.createElement("style")
    style.id = "ai-translator-spinner-styles"
    style.textContent = `
.ai-translator-spinner { width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, 0.25); border-top-color: currentColor; border-radius: 50%; animation: ai-translator-spin 0.8s linear infinite; margin: 0 auto; box-sizing: border-box; }
.ai-translator-spinner-hidden-text { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); border: 0; }
@keyframes ai-translator-spin { to { transform: rotate(360deg); } }
`
    document.head?.appendChild(style)
    spinnerStylesInjected = true
}

// ============================================================================
// Content Rendering
// ============================================================================

/**
 * Render the full content of a tooltip based on the current translation state.
 * Handles loading (text or spinner), error, and success variants.
 * Also applies dynamic font size and color derived from the surrounding page text.
 *
 * V2: No longer takes an `anchor` parameter. Style calculation uses `originalElement` only;
 * the anchor parameter is always passed as `null` to `calculateTooltipStyle`.
 *
 * @param tooltip - The tooltip element whose innerHTML will be replaced.
 * @param state - The current translation state to render.
 * @param originalElement - The DOM element the selection originated in (used to inherit font styles).
 * @param userSettings - Optional per-call display setting overrides.
 * @returns The computed `TooltipStyle`, including the `spaceCalculation` needed for line-height adjustment.
 */
export function renderTooltipContent(
    tooltip: HTMLElement,
    state: TranslationState,
    originalElement: HTMLElement | null,
    userSettings?: DisplayUserSettings
): styleCalculator.TooltipStyle {
    const content = getTooltipContentElement(tooltip)
    content.innerHTML = ""

    const minFontSize = resolveMinFontSizePx(userSettings)
    // V2: pass null for anchor — no anchor element exists in the Range-based architecture
    const style = styleCalculator.calculateTooltipStyle(originalElement, null, 16, minFontSize)
    tooltip.style.fontSize = `${style.fontSize}px`
    content.style.fontSize = `${style.fontSize}px`

    // Error state uses a dedicated CSS class color; clear inline color to avoid conflict.
    if (state.status !== "error") {
        tooltip.style.color = style.color
        content.style.color = style.color
    } else {
        tooltip.style.color = ""
        content.style.color = "#FF6B35"
    }

    content.style.fontFamily = tooltip.style.fontFamily
    content.style.fontWeight = tooltip.style.fontWeight

    if (state.status === "loading") {
        tooltip.classList.add("loading")
        tooltip.classList.remove("error")

        if (state.loadingVariant === "spinner") {
            tooltip.dataset.loadingVariant = "spinner"
            tooltip.dataset.sourceText = state.text
            ensureSpinnerStyles()
            tooltip.dataset.fullText = ""
            content.textContent = ""

            const wrapper = document.createElement("div")
            wrapper.style.display = "flex"
            wrapper.style.justifyContent = "center"
            wrapper.style.alignItems = "center"
            wrapper.style.gap = "6px"

            const spinner = document.createElement("div")
            spinner.className = "ai-translator-spinner"
            spinner.style.color = style.color

            // Visually hidden text keeps the tooltip accessible while the spinner is showing.
            const hiddenText = document.createElement("span")
            hiddenText.className = "ai-translator-spinner-hidden-text"
            hiddenText.textContent = state.text
            spinner.appendChild(hiddenText)

            wrapper.appendChild(spinner)
            content.appendChild(wrapper)
        } else {
            delete tooltip.dataset.loadingVariant
            tooltip.dataset.sourceText = state.text
            tooltip.dataset.fullText = state.text
            content.textContent = state.text
        }
    } else if (state.status === "error") {
        delete tooltip.dataset.loadingVariant
        tooltip.dataset.sourceText = state.text
        tooltip.dataset.fullText = state.text
        content.textContent = state.text
        tooltip.classList.add("error")
        tooltip.classList.remove("loading")
    } else if (state.status === "success") {
        delete tooltip.dataset.loadingVariant
        tooltip.dataset.sourceText = state.translation
        tooltip.dataset.fullText = state.translation
        content.textContent = state.translation
        tooltip.classList.remove("loading", "error")
    }

    const tooltipComputedStyle = window.getComputedStyle(tooltip)
    const contentComputedStyle = window.getComputedStyle(content)
    logger.debug("[TooltipRender] Applied tooltip styles", {
        status: state.status,
        originalElement: describeElement(originalElement),
        tooltipInlineColor: formatStyleValue(tooltip.style.color),
        tooltipComputedColor: formatStyleValue(tooltipComputedStyle.color),
        contentInlineColor: formatStyleValue(content.style.color),
        contentComputedColor: formatStyleValue(contentComputedStyle.color),
        tooltipInlineFontSize: formatStyleValue(tooltip.style.fontSize),
        contentInlineFontSize: formatStyleValue(content.style.fontSize),
        contentComputedFontSize: formatStyleValue(contentComputedStyle.fontSize),
        previewText: formatStyleValue(content.textContent?.slice(0, 80)),
    })

    return style
}
