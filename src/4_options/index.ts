import { APP_EDITION, UNDERLINE_OPACITY } from "@/0_common/constants"
import * as i18nModule from "@/0_common/utils/i18n"
import * as loggerModule from "@/0_common/utils/logger"
import * as colorUtils from "@/0_common/utils/colorUtils"
import * as settingsManagerModule from "@/4_options/modules/settingsManager"
import type * as types from "@/0_common/types"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import * as translationFontSizeModule from "@/0_common/constants/translationFontSize"

const logger = loggerModule.createLogger("Options")
const DEFAULT_DOCUMENTATION_URL = "https://tapword.ai"

const PREVIEW_ORIGINAL_FONT_PX = 16
const PREVIEW_ORIGINAL_LINE_HEIGHT_PX = 20
const PREVIEW_UI_SPACING_PX = 3
const PREVIEW_MAX_FONT_RATIO = 0.8
const PREVIEW_SAFETY_DELTA_PX = 1

function readFiniteNumber(value: string, fallback: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
        return fallback
    }
    return parsed
}

function computePreviewTooltipFontPx(minFontPx: number, nextLineGapPx: number): { tooltipFontPx: number; requiredLineHeightPx: number } {
    const lineSpacing = PREVIEW_ORIGINAL_LINE_HEIGHT_PX - PREVIEW_ORIGINAL_FONT_PX
    const availableSpace = lineSpacing - PREVIEW_UI_SPACING_PX
    const maxFontPx = PREVIEW_ORIGINAL_FONT_PX * PREVIEW_MAX_FONT_RATIO
    const effectiveAvailable = Math.max(availableSpace - PREVIEW_SAFETY_DELTA_PX - nextLineGapPx, 0)

    let tooltipFontPx = Math.min(effectiveAvailable, maxFontPx)
    tooltipFontPx = Math.max(tooltipFontPx, minFontPx)

    const targetAvailable = Math.max(minFontPx + PREVIEW_SAFETY_DELTA_PX + nextLineGapPx, 0)
    const increase = Math.max(targetAvailable - availableSpace, 0)
    const requiredLineHeightPx = PREVIEW_ORIGINAL_LINE_HEIGHT_PX + increase

    return { tooltipFontPx, requiredLineHeightPx }
}

function applyCommunityUiOverrides(): void {
    if (APP_EDITION !== "community") {
        const autoPlayNote = document.getElementById("autoPlayAudioCommunityNote")
        autoPlayNote?.remove()
        return
    }

    // Show community edition subtitle
    const communitySubtitle = document.getElementById("communitySubtitle")
    if (communitySubtitle) {
        communitySubtitle.style.display = "inline"
    }

    const connectionCardTitle = document.getElementById("connectionCardTitle")
    if (connectionCardTitle) {
        connectionCardTitle.style.display = "none"
    }

    const connectionCard = document.getElementById("connectionCard")
    if (connectionCard) {
        connectionCard.style.display = "none"
    }

    const customApiHelper = document.querySelector('[data-i18n-key="popup.section.customApi.helper"]')
    customApiHelper?.setAttribute("data-i18n-key", "popup.section.customApi.helper.community")

    const autoPlayToggle = document.getElementById("autoPlayAudio") as HTMLInputElement | null
    const autoPlayItem = document.getElementById("autoPlayAudioSettingItem")
    const autoPlayNote = document.getElementById("autoPlayAudioCommunityNote")

    if (autoPlayToggle) {
        autoPlayToggle.checked = false
        autoPlayToggle.disabled = true
    }

    autoPlayItem?.classList.add("is-disabled")

    if (autoPlayNote) {
        autoPlayNote.setAttribute("data-i18n-key", "popup.autoPlayAudio.communityNote")
        autoPlayNote.textContent = i18nModule.translate("popup.autoPlayAudio.communityNote")
        autoPlayNote.classList.add("is-disabled")
    }
}

function positionPreviewTooltip(stage: HTMLElement, anchor: HTMLElement, tooltip: HTMLElement, verticalOffsetPx: number): void {
    const stageRect = stage.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()

    const top = anchorRect.bottom - stageRect.top + verticalOffsetPx
    const tooltipWidth = tooltip.offsetWidth || 0

    const idealLeft = anchorRect.left - stageRect.left + (anchorRect.width - tooltipWidth) / 2
    const pad = 8
    const maxLeft = Math.max(pad, stageRect.width - tooltipWidth - pad)
    const left = Math.max(pad, Math.min(idealLeft, maxLeft))

    tooltip.style.top = `${top}px`
    tooltip.style.left = `${left}px`
}

// TODO: Refactor this function into a separate class (e.g., TooltipPreviewRenderer) to separate DOM querying, layout calculation, and event handling.
async function setupTooltipSpacingPreview(): Promise<void> {
    const stage = document.getElementById("tooltipPreviewStage")
    const paragraph = document.getElementById("tooltipPreviewParagraph")
    const anchor1 = document.getElementById("tooltipPreviewAnchor1")
    const anchor = document.getElementById("tooltipPreviewAnchor")
    const tooltip1 = document.getElementById("tooltipPreviewTooltip1")
    const tooltip = document.getElementById("tooltipPreviewTooltip")

    const gapInput = document.getElementById("tooltipNextLineGapPxV2") as HTMLInputElement | null
    const offsetInput = document.getElementById("tooltipVerticalOffsetPxV2") as HTMLInputElement | null
    const underlineInput = document.getElementById("textUnderlineOffsetPxV2") as HTMLInputElement | null

    const gapWarning = document.getElementById("tooltipNextLineGapPxV2Warning")
    const offsetWarning = document.getElementById("tooltipVerticalOffsetPxV2Warning")
    const underlineWarning = document.getElementById("textUnderlineOffsetPxV2Warning")

    const fontPresetSelect = document.getElementById("translationFontSizePreset") as HTMLSelectElement | null
    const autoAdjustHeightInput = document.getElementById("autoAdjustHeight") as HTMLInputElement | null

    if (
        !stage ||
        !paragraph ||
        !anchor1 ||
        !anchor ||
        !tooltip1 ||
        !tooltip ||
        !gapInput ||
        !offsetInput ||
        !underlineInput ||
        !fontPresetSelect ||
        !autoAdjustHeightInput
    ) {
        return
    }

    const settings = await storageManagerModule.getUserSettings()
    if (!gapInput.value) {
        gapInput.value = String(settings.tooltipNextLineGapPxV2)
    }
    if (!offsetInput.value) {
        offsetInput.value = String(settings.tooltipVerticalOffsetPxV2)
    }
    if (!underlineInput.value) {
        underlineInput.value = String(settings.textUnderlineOffsetPxV2)
    }

    let didLogInvisibleOnce = false

    const isElementMeasurable = (element: HTMLElement): boolean => {
        if (!element.isConnected) {
            return false
        }
        if (element.offsetParent === null) {
            return false
        }
        const rect = element.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
    }

    const schedulePosition = (verticalOffsetPx: number): void => {
        requestAnimationFrame(() => {
            const stageOk = isElementMeasurable(stage)
            const anchor1Ok = isElementMeasurable(anchor1)
            const anchorOk = isElementMeasurable(anchor)

            if (!stageOk || !anchor1Ok || !anchorOk) {
                if (!didLogInvisibleOnce) {
                    const stageRect = stage.getBoundingClientRect()
                    const anchor1Rect = anchor1.getBoundingClientRect()
                    const anchorRect = anchor.getBoundingClientRect()
                    logger.debug("Tooltip preview skipped positioning (elements not measurable)", {
                        stage: { width: stageRect.width, height: stageRect.height, top: stageRect.top, left: stageRect.left },
                        anchor1: { width: anchor1Rect.width, height: anchor1Rect.height, top: anchor1Rect.top, left: anchor1Rect.left },
                        anchor: { width: anchorRect.width, height: anchorRect.height, top: anchorRect.top, left: anchorRect.left },
                    })
                    didLogInvisibleOnce = true
                }
                return
            }

            didLogInvisibleOnce = false
            positionPreviewTooltip(stage, anchor1, tooltip1, verticalOffsetPx)
            positionPreviewTooltip(stage, anchor, tooltip, verticalOffsetPx)
        })
    }

    const updatePreview = (updatedSettings?: types.UserSettings) => {
        const currentSettings = updatedSettings || settings

        let nextLineGapPx = readFiniteNumber(gapInput.value, currentSettings.tooltipNextLineGapPxV2)
        let verticalOffsetPx = readFiniteNumber(offsetInput.value, currentSettings.tooltipVerticalOffsetPxV2)
        let underlineOffsetPx = readFiniteNumber(underlineInput.value, currentSettings.textUnderlineOffsetPxV2)

        const wordElement = document.getElementById("wordUnderlineColorSelect")
        const wordUnderlineColor = wordElement?.dataset.value || currentSettings.wordUnderlineColorV2
        
        const sentenceElement = document.getElementById("sentenceUnderlineColorSelect")
        const sentenceUnderlineColor = sentenceElement?.dataset.value || currentSettings.sentenceUnderlineColor

        // Show warning if values are out of range
        const gapOutOfRange = nextLineGapPx < 0 || nextLineGapPx > 20
        const offsetOutOfRange = verticalOffsetPx < 0 || verticalOffsetPx > 20
        const underlineOutOfRange = underlineOffsetPx < 0 || underlineOffsetPx > 20

        if (gapWarning) {
            gapWarning.classList.toggle("show", gapOutOfRange)
        }
        if (offsetWarning) {
            offsetWarning.classList.toggle("show", offsetOutOfRange)
        }
        if (underlineWarning) {
            underlineWarning.classList.toggle("show", underlineOutOfRange)
        }

        // Clamp values to valid range [0, 20]
        nextLineGapPx = Math.max(0, Math.min(20, nextLineGapPx))
        verticalOffsetPx = Math.max(0, Math.min(20, verticalOffsetPx))
        underlineOffsetPx = Math.max(0, Math.min(20, underlineOffsetPx))

        const autoAdjustHeight = autoAdjustHeightInput.checked

        const resolved = translationFontSizeModule.resolveTranslationFontSize(fontPresetSelect.value as types.TranslationFontSizePreset)

        paragraph.style.fontSize = `${PREVIEW_ORIGINAL_FONT_PX}px`

        const { tooltipFontPx, requiredLineHeightPx } = computePreviewTooltipFontPx(resolved.px, nextLineGapPx)

        paragraph.style.lineHeight = autoAdjustHeight ? `${requiredLineHeightPx}px` : `${PREVIEW_ORIGINAL_LINE_HEIGHT_PX}px`
        tooltip1.style.fontSize = `${tooltipFontPx}px`
        tooltip.style.fontSize = `${tooltipFontPx}px`
        
        anchor1.style.textUnderlineOffset = `${underlineOffsetPx}px`
        anchor.style.textUnderlineOffset = `${underlineOffsetPx}px`
        anchor1.style.textDecorationColor = colorUtils.addOpacityToHex(wordUnderlineColor, UNDERLINE_OPACITY)
        anchor.style.textDecorationColor = colorUtils.addOpacityToHex(sentenceUnderlineColor, UNDERLINE_OPACITY)

        // Force reflow to ensure tooltip dimensions are calculated before positioning
        void tooltip1.offsetWidth
        void tooltip.offsetWidth

        schedulePosition(verticalOffsetPx)
    }

    gapInput.addEventListener("input", () => updatePreview())
    offsetInput.addEventListener("input", () => updatePreview())
    underlineInput.addEventListener("input", () => updatePreview())
    fontPresetSelect.addEventListener("change", () => updatePreview())
    autoAdjustHeightInput.addEventListener("change", () => updatePreview())
    window.addEventListener("resize", () => updatePreview())

    document.addEventListener("settingChange", (event: Event) => {
        const customEvent = event as CustomEvent
        if (customEvent.detail.key === "wordUnderlineColorV2" || customEvent.detail.key === "sentenceUnderlineColor") {
            updatePreview()
        }
    })

    const owningSection = stage.closest<HTMLElement>(".settings-section")
    if (owningSection) {
        const observer = new MutationObserver(() => {
            updatePreview()
        })
        observer.observe(owningSection, { attributes: true, attributeFilter: ["class", "style"] })
    }

    // Ensure correct placement after fonts finish loading (if any web fonts exist).
    document.fonts?.ready.then(() => updatePreview()).catch(() => {})

    updatePreview()
}

async function fetchWebsiteUrl(): Promise<string | null> {
    try {
        const request: types.PopupBootstrapRequestMessage = { type: "POPUP_BOOTSTRAP_REQUEST" }

        const response = await new Promise<types.PopupBootstrapResponseMessage | null>((resolve) => {
            chrome.runtime.sendMessage(request, (message) => {
                resolve((message ?? null) as types.PopupBootstrapResponseMessage | null)
            })
        })

        if (!response || response.type !== "POPUP_BOOTSTRAP_RESPONSE" || !response.success) {
            return null
        }

        const websiteUrl = response.data.websiteUrl
        return websiteUrl.startsWith("http") ? websiteUrl : `https://${websiteUrl}`
    } catch (error) {
        logger.warn("Failed to fetch website url", error)
        return null
    }
}

function setupNavigation(): void {
    const navItems = document.querySelectorAll<HTMLElement>(".nav-item")
    const sections = document.querySelectorAll<HTMLElement>(".settings-section")

    navItems.forEach((item) => {
        item.addEventListener("click", (event) => {
            event.preventDefault()

            navItems.forEach((nav) => nav.classList.remove("active"))
            item.classList.add("active")

            const sectionId = item.getAttribute("data-section")
            sections.forEach((section) => {
                if (section.id === sectionId) {
                    section.classList.add("active")
                } else {
                    section.classList.remove("active")
                }
            })
        })
    })
}

function setupDocumentationButton(websiteUrl: string | null): void {
    const docsButton = document.getElementById("documentationButton") as HTMLButtonElement | null

    if (!docsButton) {
        return
    }

    docsButton.addEventListener("click", () => {
        const targetUrl = websiteUrl ?? DEFAULT_DOCUMENTATION_URL

        try {
            chrome.tabs.create({ url: targetUrl })
        } catch (error) {
            logger.warn("Failed to open documentation via chrome.tabs, falling back to window.open", error)
            window.open(targetUrl, "_blank", "noopener,noreferrer")
        }
    })
}

function setupGithubButton(): void {
    const githubButton = document.getElementById("githubButton")
    if (!githubButton) {
        return
    }

    githubButton.addEventListener("click", () => {
        const targetUrl = "https://github.com/hongyuan007/tapword-translator"
        try {
            chrome.tabs.create({ url: targetUrl })
        } catch (error) {
            logger.warn("Failed to open GitHub via chrome.tabs, falling back to window.open", error)
            window.open(targetUrl, "_blank", "noopener,noreferrer")
        }
    })
}

function setVersion(): void {
    const versionDisplay = document.getElementById("versionDisplay")
    if (!versionDisplay) {
        return
    }

    const version = chrome.runtime.getManifest().version
    versionDisplay.textContent = version
}

async function initializeOptions(): Promise<void> {
    logger.info("Options initializing")

    try {
        i18nModule.initI18n()
        applyCommunityUiOverrides()
        i18nModule.applyTranslations()

        await settingsManagerModule.loadSettings()
        settingsManagerModule.setupSettingChangeListeners()
        settingsManagerModule.setupCustomApiValidation()
        settingsManagerModule.setupMTranServerTest()
        settingsManagerModule.setupBingTranslateTest()
        await setupTooltipSpacingPreview()

        const websiteUrl = await fetchWebsiteUrl()

        setVersion()
        setupNavigation()
        setupDocumentationButton(websiteUrl)
        setupGithubButton()

        logger.info("Options initialized")
    } finally {
        document.documentElement.classList.remove("loading")
    }
}

document.addEventListener("DOMContentLoaded", () => {
    initializeOptions().catch((error) => {
        logger.error("Failed to initialize options:", error)
    })
})
