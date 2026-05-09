import { APP_EDITION, UNDERLINE_OPACITY, UNDERLINE_OFFSET_INTERNAL_SHIFT_PX } from "@/0_common/constants"
import * as i18nModule from "@/0_common/utils/i18n"
import * as loggerModule from "@/0_common/utils/logger"
import * as colorUtils from "@/0_common/utils/colorUtils"
import * as settingsManagerModule from "@/4_options/modules/settingsManager"
import type * as types from "@/0_common/types"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import * as translationFontSizeModule from "@/0_common/constants/translationFontSize"
import * as iconVariantsModule from "@/12_floating_button/ui/iconVariants"
import * as floatingButtonConstants from "@/12_floating_button/constants"
import type { IconVariant } from "@/12_floating_button/types"

const logger = loggerModule.createLogger("Options")
const DEFAULT_DOCUMENTATION_URL = "https://tapword.ai"

const PREVIEW_ORIGINAL_FONT_PX = 16
const PREVIEW_ORIGINAL_LINE_HEIGHT_PX = 20
const PREVIEW_MAX_FONT_RATIO = 0.8
const PREVIEW_SAFETY_DELTA_PX = 1

function readFiniteNumber(value: string, fallback: number): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) {
        return fallback
    }
    return parsed
}

function resolveEffectiveUnderlineOffsetPx(value: number): number {
    return value - UNDERLINE_OFFSET_INTERNAL_SHIFT_PX
}

function computePreviewTooltipFontPx(minFontPx: number, effectiveUnderlineOffsetPx: number, reservedSpacePx: number): { tooltipFontPx: number; requiredLineHeightPx: number } {
    const lineSpacing = PREVIEW_ORIGINAL_LINE_HEIGHT_PX - PREVIEW_ORIGINAL_FONT_PX
    const availableSpace = lineSpacing - effectiveUnderlineOffsetPx
    const maxFontPx = PREVIEW_ORIGINAL_FONT_PX * PREVIEW_MAX_FONT_RATIO
    const effectiveAvailable = Math.max(availableSpace - PREVIEW_SAFETY_DELTA_PX - reservedSpacePx, 0)

    let tooltipFontPx = Math.min(effectiveAvailable, maxFontPx)
    tooltipFontPx = Math.max(tooltipFontPx, minFontPx)

    const targetAvailable = Math.max(minFontPx + PREVIEW_SAFETY_DELTA_PX + reservedSpacePx, 0)
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

function bindRangeValue(input: HTMLInputElement | null, valueElementId: string): void {
    if (!input) return
    const valueElement = document.getElementById(valueElementId)
    if (!valueElement) return

    const formatRangeValue = (): string => {
        const value = Number(input.value)
        const step = input.step === "any" ? NaN : Number(input.step)

        if (!Number.isFinite(value)) {
            return input.value
        }

        if (!Number.isFinite(step) || Number.isInteger(step)) {
            return String(value)
        }

        const decimalPart = input.step.split(".")[1] ?? ""
        return value.toFixed(decimalPart.length)
    }

    const update = () => {
        valueElement.textContent = formatRangeValue()
        const min = Number(input.min || 0)
        const max = Number(input.max || 100)
        const value = Number(input.value)
        const percent = max > min ? ((value - min) / (max - min)) * 100 : 0
        input.style.setProperty("--range-progress", `${percent}%`)
    }

    update()
    input.addEventListener("input", update)
    input.addEventListener("change", update)
}

function positionPreviewTooltip(stage: HTMLElement, anchor: HTMLElement, tooltip: HTMLElement, underlineOffsetPx: number): void {
    const stageRect = stage.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const anchorWidth = anchorRect.width

    const top = anchorRect.bottom - stageRect.top + underlineOffsetPx
    tooltip.style.minWidth = `${anchorWidth}px`
    tooltip.style.maxWidth = `${anchorWidth}px`

    const tooltipWidth = tooltip.offsetWidth || anchorWidth

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
    const tooltip1Content = tooltip1?.querySelector<HTMLElement>(".tooltip-preview-tooltip-content")
    const tooltipContent = tooltip?.querySelector<HTMLElement>(".tooltip-preview-tooltip-content")

    const underlineInput = document.getElementById("tooltipUnderlineOffsetPxV3") as HTMLInputElement | null
    const textOffsetInput = document.getElementById("tooltipTextOffsetPxV3") as HTMLInputElement | null
    const bottomSpacingInput = document.getElementById("tooltipBottomSpacingPxV3") as HTMLInputElement | null

    const fontPresetSelect = document.getElementById("translationFontSizePresetV2") as HTMLSelectElement | null
    const autoAdjustHeightInput = document.getElementById("autoAdjustHeight") as HTMLInputElement | null

    if (
        !stage ||
        !paragraph ||
        !anchor1 ||
        !anchor ||
        !tooltip1 ||
        !tooltip ||
        !tooltip1Content ||
        !tooltipContent ||
        !underlineInput ||
        !textOffsetInput ||
        !bottomSpacingInput ||
        !fontPresetSelect ||
        !autoAdjustHeightInput
    ) {
        return
    }

    const settings = await storageManagerModule.getUserSettings()
    if (!underlineInput.value) {
        underlineInput.value = String(settings.tooltipUnderlineOffsetPxV3)
    }
    if (!textOffsetInput.value) {
        textOffsetInput.value = String(settings.tooltipTextOffsetPxV3)
    }
    if (!bottomSpacingInput.value) {
        bottomSpacingInput.value = String(settings.tooltipBottomSpacingPxV3)
    }

    bindRangeValue(underlineInput, "tooltipUnderlineOffsetPxV3Value")
    bindRangeValue(textOffsetInput, "tooltipTextOffsetPxV3Value")
    bindRangeValue(bottomSpacingInput, "tooltipBottomSpacingPxV3Value")

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

    const schedulePosition = (underlineOffsetPx: number): void => {
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
            positionPreviewTooltip(stage, anchor1, tooltip1, underlineOffsetPx)
            positionPreviewTooltip(stage, anchor, tooltip, underlineOffsetPx)
        })
    }

    const updatePreview = (updatedSettings?: types.UserSettings) => {
        const currentSettings = updatedSettings || settings

        let underlineOffsetPx = readFiniteNumber(underlineInput.value, currentSettings.tooltipUnderlineOffsetPxV3)
        let textOffsetPx = readFiniteNumber(textOffsetInput.value, currentSettings.tooltipTextOffsetPxV3)
        let bottomSpacingPx = readFiniteNumber(bottomSpacingInput.value, currentSettings.tooltipBottomSpacingPxV3)

        const wordElement = document.getElementById("wordUnderlineColorSelect")
        const wordUnderlineColor = wordElement?.dataset.value || currentSettings.wordUnderlineColorV2
        
        const sentenceElement = document.getElementById("sentenceUnderlineColorSelect")
        const sentenceUnderlineColor = sentenceElement?.dataset.value || currentSettings.sentenceUnderlineColor

        // Clamp values to valid range [0, 20]
        underlineOffsetPx = Math.max(0, Math.min(20, underlineOffsetPx))
        textOffsetPx = Math.max(0, Math.min(20, textOffsetPx))
        bottomSpacingPx = Math.max(0, Math.min(20, bottomSpacingPx))

        const effectiveUnderlineOffsetPx = resolveEffectiveUnderlineOffsetPx(underlineOffsetPx)

        const autoAdjustHeight = autoAdjustHeightInput.checked

        const resolved = translationFontSizeModule.resolveTranslationFontSize(fontPresetSelect.value as types.TranslationFontSizePreset)

        paragraph.style.fontSize = `${PREVIEW_ORIGINAL_FONT_PX}px`

        const { tooltipFontPx, requiredLineHeightPx } = computePreviewTooltipFontPx(resolved.px, effectiveUnderlineOffsetPx, textOffsetPx + bottomSpacingPx)

        paragraph.style.lineHeight = autoAdjustHeight ? `${requiredLineHeightPx}px` : `${PREVIEW_ORIGINAL_LINE_HEIGHT_PX}px`
        tooltip1.style.fontSize = `${tooltipFontPx}px`
        tooltip.style.fontSize = `${tooltipFontPx}px`

        tooltip1Content.style.marginTop = `${textOffsetPx}px`
        tooltipContent.style.marginTop = `${textOffsetPx}px`
        tooltip1Content.style.paddingBottom = `${bottomSpacingPx}px`
        tooltipContent.style.paddingBottom = `${bottomSpacingPx}px`
        tooltip1.style.textAlign = "center"
        tooltip.style.textAlign = "center"
        tooltip1.style.borderTopColor = colorUtils.addOpacityToHex(wordUnderlineColor, UNDERLINE_OPACITY)
        tooltip.style.borderTopColor = colorUtils.addOpacityToHex(sentenceUnderlineColor, UNDERLINE_OPACITY)

        // Force reflow to ensure tooltip dimensions are calculated before positioning
        void tooltip1.offsetWidth
        void tooltip.offsetWidth

        schedulePosition(effectiveUnderlineOffsetPx)
    }

    underlineInput.addEventListener("input", () => updatePreview())
    textOffsetInput.addEventListener("input", () => updatePreview())
    bottomSpacingInput.addEventListener("input", () => updatePreview())
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

// --- Icon Variant Picker ---

const ICON_VARIANT_KEYS: IconVariant[] = ["v1", "v2", "v3", "v4", "v5", "v6"]

function highlightSelectedVariant(variant: string): void {
    const container = document.getElementById("icon-variant-picker")
    if (!container) return
    const radio = container.querySelector<HTMLInputElement>(`input[name="iconVariant"][value="${variant}"]`)
    if (radio) radio.checked = true
}

async function loadCurrentIconVariant(): Promise<void> {
    const result = await chrome.storage.local.get(floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY)
    const config = result[floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY] || floatingButtonConstants.DEFAULT_CONFIG
    const currentVariant = config.iconVariant || "v1"
    highlightSelectedVariant(currentVariant)
}

async function selectIconVariant(variant: IconVariant): Promise<void> {
    const result = await chrome.storage.local.get(floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY)
    const config = result[floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY] || { ...floatingButtonConstants.DEFAULT_CONFIG }
    config.iconVariant = variant
    await chrome.storage.local.set({ [floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY]: config })
    highlightSelectedVariant(variant)
    updateAppearancePreview().catch((err) => logger.warn("Failed to update appearance preview", err))
}

function initIconVariantPicker(color: string): void {
    const container = document.getElementById("icon-variant-picker")
    if (!container) return

    for (const key of ICON_VARIANT_KEYS) {
        const label = document.createElement("label")
        label.className = "icon-option"
        label.title = i18nModule.translate(`popup.floatingButtonIcon.${key}`)
        label.innerHTML = `
            <input type="radio" name="iconVariant" value="${key}">
            <span class="icon-preview icon-preview--variant">${iconVariantsModule.ICON_VARIANTS[key](color)}</span>
        `
        const radio = label.querySelector("input")!
        radio.addEventListener("change", () => selectIconVariant(key))
        container.appendChild(label)
    }

    loadCurrentIconVariant()
}

function refreshIconVariantPreviews(color: string): void {
    const container = document.getElementById("icon-variant-picker")
    if (!container) return
    const previews = container.querySelectorAll<HTMLElement>(".icon-preview--variant")
    const keys = ICON_VARIANT_KEYS
    previews.forEach((preview, index) => {
        const key = keys[index]
        if (key) {
            preview.innerHTML = iconVariantsModule.ICON_VARIANTS[key](color)
        }
    })
}

// --- Floating Button Color Picker ---

async function loadFloatingButtonColor(): Promise<string> {
    const result = await chrome.storage.local.get(floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY)
    const config = result[floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY] || floatingButtonConstants.DEFAULT_CONFIG
    return config.iconColor || floatingButtonConstants.DEFAULT_ICON_COLOR
}

function updateFloatingButtonColorDisplay(wrapper: HTMLElement, color: string): void {
    const preview = wrapper.querySelector<HTMLElement>("#floatingButtonColorPreview")
    const label = wrapper.querySelector<HTMLElement>("#floatingButtonColorLabel")
    if (preview) preview.style.backgroundColor = color

    const matchOption = wrapper.querySelector<HTMLElement>(`.custom-option[data-value="${color}"]`)
    if (label && matchOption) {
        const nameSpan = matchOption.querySelector<HTMLElement>("span[data-i18n-key]")
        if (nameSpan) {
            const key = nameSpan.getAttribute("data-i18n-key")
            if (key) {
                label.textContent = i18nModule.translate(key)
                label.setAttribute("data-i18n-key", key)
            } else {
                label.textContent = nameSpan.textContent || color
            }
        }
    }

    wrapper.querySelectorAll(".custom-option").forEach((opt) => {
        opt.classList.toggle("selected", (opt as HTMLElement).dataset.value === color)
    })
}

async function saveFloatingButtonColor(color: string): Promise<void> {
    const result = await chrome.storage.local.get(floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY)
    const config = result[floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY] || { ...floatingButtonConstants.DEFAULT_CONFIG }
    config.iconColor = color
    await chrome.storage.local.set({ [floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY]: config })
}

function initFloatingButtonColorPicker(currentColor: string): void {
    const wrapper = document.getElementById("floatingButtonColorSelect")
    if (!wrapper) return

    updateFloatingButtonColorDisplay(wrapper, currentColor)

    // Toggle dropdown open/close
    const trigger = wrapper.querySelector(".custom-select-trigger")
    if (trigger) {
        trigger.addEventListener("click", (e) => {
            e.stopPropagation()
            document.querySelectorAll(".custom-select-wrapper.open").forEach((other) => {
                if (other !== wrapper) other.classList.remove("open")
            })
            wrapper.classList.toggle("open")
        })
    }

    // Option click handlers
    const options = wrapper.querySelectorAll<HTMLElement>(".custom-option")
    options.forEach((option) => {
        option.addEventListener("click", async (e) => {
            e.stopPropagation()
            const color = option.dataset.value
            if (!color) return
            await saveFloatingButtonColor(color)
            updateFloatingButtonColorDisplay(wrapper, color)
            refreshIconVariantPreviews(color)
            wrapper.classList.remove("open")
            updateAppearancePreview().catch((err) => logger.warn("Failed to update appearance preview", err))
        })
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

// --- Auto-Hide on Quota Exhaustion Toggle ---

async function loadAutoHideOnQuotaSetting(): Promise<void> {
    const result = await chrome.storage.local.get(floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY)
    const config = result[floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY] || floatingButtonConstants.DEFAULT_CONFIG
    const checkbox = document.getElementById("autoHideOnQuotaExhausted") as HTMLInputElement | null
    if (checkbox) {
        checkbox.checked = config.autoHideOnQuotaExhausted ?? floatingButtonConstants.DEFAULT_CONFIG.autoHideOnQuotaExhausted
    }
}

function setupAutoHideOnQuotaListener(): void {
    const checkbox = document.getElementById("autoHideOnQuotaExhausted") as HTMLInputElement | null
    if (!checkbox) return

    checkbox.addEventListener("change", async () => {
        const result = await chrome.storage.local.get(floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY)
        const config = result[floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY] || { ...floatingButtonConstants.DEFAULT_CONFIG }
        config.autoHideOnQuotaExhausted = checkbox.checked
        await chrome.storage.local.set({ [floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY]: config })
        logger.info(`Auto-hide on quota exhaustion: ${checkbox.checked}`)
    })
}

async function loadFloatingButtonEnabledSetting(): Promise<void> {
    const result = await chrome.storage.local.get(floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY)
    const config = result[floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY] || floatingButtonConstants.DEFAULT_CONFIG
    const checkbox = document.getElementById("floatingButtonEnabledOptions") as HTMLInputElement | null
    if (checkbox) {
        checkbox.checked = config.enabled ?? floatingButtonConstants.DEFAULT_CONFIG.enabled
    }
}

function setupFloatingButtonEnabledListener(): void {
    const checkbox = document.getElementById("floatingButtonEnabledOptions") as HTMLInputElement | null
    if (!checkbox) return

    checkbox.addEventListener("change", async () => {
        const result = await chrome.storage.local.get(floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY)
        const config = result[floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY] || { ...floatingButtonConstants.DEFAULT_CONFIG }
        config.enabled = checkbox.checked
        await chrome.storage.local.set({ [floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY]: config })
        logger.info(`Floating ball enabled: ${checkbox.checked}`)
    })
}

async function updateAppearancePreview(): Promise<void> {
    const fabLightEl = document.getElementById("preview-fab-light")
    const fabDarkEl = document.getElementById("preview-fab-dark")
    const fullTransLightEl = document.getElementById("ap-full-trans-light")
    const fullTransDarkEl = document.getElementById("ap-full-trans-dark")
    const wordTooltipLightEl = document.getElementById("ap-word-tooltip-light")
    const wordTooltipDarkEl = document.getElementById("ap-word-tooltip-dark")
    const sentTooltipLightEl = document.getElementById("ap-sent-tooltip-light")
    const sentTooltipDarkEl = document.getElementById("ap-sent-tooltip-dark")

    const storageResult = await chrome.storage.local.get(floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY)
    const fabConfig = storageResult[floatingButtonConstants.FLOATING_BUTTON_STORAGE_KEY] || floatingButtonConstants.DEFAULT_CONFIG
    const iconColor: string = fabConfig.iconColor || floatingButtonConstants.DEFAULT_ICON_COLOR
    const iconVariant: IconVariant = fabConfig.iconVariant || "v1"

    const settings = await storageManagerModule.getUserSettings()

    const lightSelectEl = document.getElementById("fullTranslateLightColorSelect")
    const darkSelectEl = document.getElementById("fullTranslateDarkColorSelect")
    const lightColor = lightSelectEl?.dataset.value || settings.fullTranslateLightColor || "#064e3b"
    const darkColor = darkSelectEl?.dataset.value || settings.fullTranslateDarkColor || "#6ee7b7"

    const wordSelectEl = document.getElementById("wordUnderlineColorSelect")
    const wordUnderlineColor = wordSelectEl?.dataset.value || settings.wordUnderlineColorV2
    const sentenceSelectEl = document.getElementById("sentenceUnderlineColorSelect")
    const sentenceUnderlineColor = sentenceSelectEl?.dataset.value || settings.sentenceUnderlineColor

    // Floating ball SVG
    if (fabLightEl || fabDarkEl) {
        const fabSvg = iconVariantsModule.ICON_VARIANTS[iconVariant](iconColor)
        if (fabLightEl) fabLightEl.innerHTML = fabSvg
        if (fabDarkEl) fabDarkEl.innerHTML = fabSvg
    }

    // Full-translate text color
    if (fullTransLightEl) fullTransLightEl.style.color = lightColor
    if (fullTransDarkEl) fullTransDarkEl.style.color = darkColor

    // Underline preview colors — replicates content script: border-top with opacity
    const wordBorderColor = colorUtils.addOpacityToHex(wordUnderlineColor, UNDERLINE_OPACITY)
    const sentBorderColor = colorUtils.addOpacityToHex(sentenceUnderlineColor, UNDERLINE_OPACITY)
    if (wordTooltipLightEl) wordTooltipLightEl.style.borderTopColor = wordBorderColor
    if (wordTooltipDarkEl) wordTooltipDarkEl.style.borderTopColor = wordBorderColor
    if (sentTooltipLightEl) sentTooltipLightEl.style.borderTopColor = sentBorderColor
    if (sentTooltipDarkEl) sentTooltipDarkEl.style.borderTopColor = sentBorderColor
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
        const fabColor = await loadFloatingButtonColor()
        initIconVariantPicker(fabColor)
        initFloatingButtonColorPicker(fabColor)
        await loadAutoHideOnQuotaSetting()
        setupAutoHideOnQuotaListener()
        await loadFloatingButtonEnabledSetting()
        setupFloatingButtonEnabledListener()
        await setupTooltipSpacingPreview()
        await updateAppearancePreview()

        document.addEventListener("settingChange", (event: Event) => {
            const customEvent = event as CustomEvent
            const relevantKeys = ["wordUnderlineColorV2", "sentenceUnderlineColor", "fullTranslateLightColor", "fullTranslateDarkColor"]
            if (relevantKeys.includes(customEvent.detail?.key)) {
                updateAppearancePreview().catch((err) => logger.warn("Failed to update appearance preview", err))
            }
        })

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
