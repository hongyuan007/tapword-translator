/**
 * Settings Manager for Options Page
 *
 * Handles loading, saving, and updating user settings in the options page
 */

import { APP_EDITION } from "@/0_common/constants"
import type * as types from "@/0_common/types"
import * as i18nModule from "@/0_common/utils/i18n"
import * as languageDisplayModule from "@/0_common/utils/languageDisplay"
import * as loggerModule from "@/0_common/utils/logger"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import { getPlatformOS, PLATFORMS } from "@/0_common/utils/platformDetector"

const logger = loggerModule.createLogger("Options/Settings")
const isCommunityEdition = APP_EDITION === "community"
const AUTO_PLAY_AUDIO_SETTING_ID = "autoPlayAudio"
const FEATURE_DOT_OFF_CLASS = "feature-dot-off"

function syncSingleClickFeatureDotState(enabled: boolean): void {
    const singleClickInput = document.getElementById("singleClickTranslate")
    const settingItem = singleClickInput?.closest(".setting-item")
    settingItem?.classList.toggle(FEATURE_DOT_OFF_CLASS, !enabled)
}

function setTranslationControlsEnabled(enabled: boolean): void {
    const dependentIds = [
        "showIcon",
        "singleClickTranslate",
        "doubleClickTranslateV2",
        "doubleClickSentenceTranslate",
        "doubleClickSentenceTriggerKey"
    ]

    dependentIds.forEach((id) => {
        const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null
        if (!input) {
            return
        }

        input.disabled = !enabled

        const settingItem = input.closest(".setting-item")
        if (settingItem) {
            settingItem.classList.toggle("is-disabled", !enabled)
        }
    })
}

function lockAutoPlayAudioToggle(): void {
    if (!isCommunityEdition) {
        return
    }

    const toggle = document.getElementById(AUTO_PLAY_AUDIO_SETTING_ID) as HTMLInputElement | null
    const settingItem = document.getElementById("autoPlayAudioSettingItem")

    if (!toggle) {
        return
    }

    toggle.checked = false
    toggle.disabled = true
    settingItem?.classList.add("is-disabled")
}

async function ensureCommunityAutoPlayDisabled(settings: types.UserSettings): Promise<types.UserSettings> {
    if (!isCommunityEdition || settings.autoPlayAudio === false) {
        return settings
    }

    const updated = await storageManagerModule.updateUserSettings({ autoPlayAudio: false })
    return updated
}

async function restoreDependentTogglesIfAllOff(): Promise<void> {
    const showIconInput = document.getElementById("showIcon") as HTMLInputElement | null
    const singleClickInput = document.getElementById("singleClickTranslate") as HTMLInputElement | null
    const doubleClickInput = document.getElementById("doubleClickTranslateV2") as HTMLInputElement | null
    const sentenceTranslateInput = document.getElementById("doubleClickSentenceTranslate") as HTMLInputElement | null

    if (!showIconInput || !singleClickInput || !doubleClickInput || !sentenceTranslateInput) {
        return
    }

    const allDisabled = !showIconInput.checked && !singleClickInput.checked && !doubleClickInput.checked && !sentenceTranslateInput.checked
    if (!allDisabled) {
        return
    }

    showIconInput.checked = true
    singleClickInput.checked = true
    // V2 default: Double Click OFF, Single Click ON
    // doubleClickInput.checked = false // already false if allDisabled
    sentenceTranslateInput.checked = true

    await storageManagerModule.updateUserSettings({
        showIcon: true,
        singleClickTranslate: true,
        doubleClickTranslateV2: false,
        doubleClickSentenceTranslate: true,
    })
}

/**
 * Detect OS and populate trigger key options
 */
async function populateTriggerKeyOptions(): Promise<void> {
    const select = document.getElementById("doubleClickSentenceTriggerKey") as HTMLSelectElement | null
    if (!select) return

    const os = await getPlatformOS()
    select.innerHTML = ""

    if (os === PLATFORMS.MAC) {
        // Mac Options: Command (Default), Option
        const cmdOption = document.createElement("option")
        cmdOption.value = "meta"
        cmdOption.textContent = "Command"
        select.appendChild(cmdOption)

        const optOption = document.createElement("option")
        optOption.value = "option"
        optOption.textContent = "Option"
        select.appendChild(optOption)
    } else {
        // Windows/Linux/Other Options: Alt (Default), Ctrl
        const altOption = document.createElement("option")
        altOption.value = "alt"
        altOption.textContent = "Alt"
        select.appendChild(altOption)

        const ctrlOption = document.createElement("option")
        ctrlOption.value = "ctrl"
        ctrlOption.textContent = "Ctrl"
        select.appendChild(ctrlOption)
    }
}

function updateSuppressNativeLanguageLabel(targetLanguage: string): void {
    const labelSpan = document.getElementById("suppressNativeLanguageLabel")
    if (!labelSpan) return

    const langName = languageDisplayModule.getLanguageDisplayName(targetLanguage)
    const template = i18nModule.translate("popup.suppressNativeLanguage.label")
    const styledLangName = `<span class="highlight-language">${langName}</span>`
    
    // Use innerHTML to render the span
    labelSpan.innerHTML = template.replace("{language}", styledLangName)
}

export async function loadSettings(): Promise<void> {
    try {
        await populateTriggerKeyOptions()

        let settings = await storageManagerModule.getUserSettings()
        settings = await ensureCommunityAutoPlayDisabled(settings)

        // TODO: Improve type safety. Instead of casting to unknown then Record, consider using keyof types.UserSettings type guards or maintaining the original type.
        const settingsRecord = settings as unknown as Record<string, unknown>
        logger.info("Loaded settings:", settings)

        // Update dynamic label for suppressNativeLanguage
        updateSuppressNativeLanguageLabel(settings.targetLanguage)

        const checkboxes = document.querySelectorAll('input[type="checkbox"][data-setting]')
        checkboxes.forEach((checkbox) => {
            const input = checkbox as HTMLInputElement
            const settingKey = input.dataset.setting

            if (settingKey && settingKey in settings) {
                input.checked = settingsRecord[settingKey] as boolean
            }
        })

        const selects = document.querySelectorAll("select[data-setting]")
        selects.forEach((select) => {
            const selectElement = select as HTMLSelectElement
            const settingKey = selectElement.dataset.setting
            if (settingKey && settingKey in settings) {
                selectElement.value = String(settingsRecord[settingKey])
            }
        })

        const radioButtons = document.querySelectorAll('input[type="radio"][data-setting]')
        radioButtons.forEach((radio) => {
            const input = radio as HTMLInputElement
            const settingKey = input.dataset.setting
            if (settingKey && settingKey in settings) {
                input.checked = input.value === String(settingsRecord[settingKey])
            }
        })

        const numericInputs = document.querySelectorAll('input[type="number"][data-setting], input[type="range"][data-setting]')
        numericInputs.forEach((input) => {
            const inputElement = input as HTMLInputElement
            const settingKey = inputElement.dataset.setting

            if (settingKey && settingKey in settings) {
                inputElement.value = String(settingsRecord[settingKey])
                inputElement.dispatchEvent(new Event("input", { bubbles: true }))
            }
        })

        const textInputs = document.querySelectorAll(
            'input[type="text"][data-setting], input[type="url"][data-setting], input[type="password"][data-setting]'
        )
        textInputs.forEach((input) => {
            const inputElement = input as HTMLInputElement
            const settingKey = inputElement.dataset.setting
            if (settingKey && settingKey in settings) {
                inputElement.value = String(settingsRecord[settingKey] ?? "")
            }
        })

        // Initialize Custom Selects with loaded values
        const customSelects = document.querySelectorAll(".custom-select-wrapper[data-setting]")
        customSelects.forEach((wrapper) => {
            const settingKey = (wrapper as HTMLElement).dataset.setting
            if (settingKey && settingKey in settingsRecord) {
                const value = String(settingsRecord[settingKey])
                updateCustomSelectUI(wrapper as HTMLElement, value)
            }
        })

        setTranslationControlsEnabled(settings.enableTapWord)
        updateProviderDependentUI(settings.wordTranslationProvider, false)
        lockAutoPlayAudioToggle()
        syncSingleClickFeatureDotState(settings.singleClickTranslate)
    } catch (error) {
        logger.error("Failed to load settings:", error)
    }
}

export async function saveSetting(settingKey: keyof types.UserSettings, value: boolean | string | number): Promise<void> {
    try {
        await storageManagerModule.updateUserSettings({
            [settingKey]: value,
        })
        logger.info(`Setting ${settingKey} updated to ${value}`)
    } catch (error) {
        logger.error(`Failed to save setting ${settingKey}:`, error)
    }
}

export function setupSettingChangeListeners(): void {
    setupCustomSelects()

    const checkboxes = document.querySelectorAll('input[type="checkbox"][data-setting]')
    checkboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", async (event) => {
            const input = event.target as HTMLInputElement
            const settingKey = input.dataset.setting
            if (!settingKey) {
                return
            }

            if (settingKey === AUTO_PLAY_AUDIO_SETTING_ID && isCommunityEdition) {
                input.checked = false
                lockAutoPlayAudioToggle()
                return
            }

            // Implement mutual exclusion between single-click and double-click (V2)
            if (settingKey === "singleClickTranslate" && input.checked) {
                const doubleClickInput = document.getElementById("doubleClickTranslateV2") as HTMLInputElement
                if (doubleClickInput && doubleClickInput.checked) {
                    doubleClickInput.checked = false
                    await saveSetting("doubleClickTranslateV2", false)
                }
            } else if (settingKey === "doubleClickTranslateV2" && input.checked) {
                const singleClickInput = document.getElementById("singleClickTranslate") as HTMLInputElement
                if (singleClickInput && singleClickInput.checked) {
                    singleClickInput.checked = false
                    await saveSetting("singleClickTranslate", false)
                }
            }

            await saveSetting(settingKey as keyof types.UserSettings, input.checked)

            if (settingKey === "singleClickTranslate") {
                syncSingleClickFeatureDotState(input.checked)
            }

            if (settingKey === "enableTapWord") {
                setTranslationControlsEnabled(input.checked)
                if (input.checked) {
                    await restoreDependentTogglesIfAllOff()
                }
            }
        })
    })

    const selects = document.querySelectorAll("select[data-setting]")
    selects.forEach((select) => {
        select.addEventListener("change", async (event) => {
            const selectElement = event.target as HTMLSelectElement
            const settingKey = selectElement.dataset.setting
            if (!settingKey) {
                return
            }
            const value = selectElement.value

            if (settingKey === "targetLanguage") {
                updateSuppressNativeLanguageLabel(value)
            }

            await saveSetting(settingKey as keyof types.UserSettings, value)
        })
    })

    const radioButtons = document.querySelectorAll('input[type="radio"][data-setting]')
    radioButtons.forEach((radio) => {
        radio.addEventListener("change", async (event) => {
            const input = event.target as HTMLInputElement
            const settingKey = input.dataset.setting
            if (settingKey && input.checked) {
                await saveSetting(settingKey as keyof types.UserSettings, input.value)
            }
        })
    })

    const numericInputs = document.querySelectorAll('input[type="number"][data-setting], input[type="range"][data-setting]')
    numericInputs.forEach((input) => {
        input.addEventListener("change", async (event) => {
            const inputElement = event.target as HTMLInputElement
            const settingKey = inputElement.dataset.setting
            if (!settingKey) {
                return
            }

            let parsed = Number(inputElement.value)
            if (!Number.isFinite(parsed)) {
                return
            }

            if (
                settingKey === "tooltipUnderlineOffsetPxV3" ||
                settingKey === "tooltipTextOffsetPxV3" ||
                settingKey === "tooltipBottomSpacingPxV3"
            ) {
                parsed = Math.max(0, Math.min(20, parsed))
                inputElement.value = String(parsed)
            }

            await saveSetting(settingKey as keyof types.UserSettings, parsed)
        })
    })

    const textInputs = document.querySelectorAll(
        'input[type="text"][data-setting], input[type="url"][data-setting], input[type="password"][data-setting]'
    )
    textInputs.forEach((input) => {
        input.addEventListener("change", async (event) => {
            const inputElement = event.target as HTMLInputElement
            const settingKey = inputElement.dataset.setting
            if (!settingKey) {
                return
            }

            const value = inputElement.value.trim()

            await saveSetting(settingKey as keyof types.UserSettings, value)
        })
    })
}

/**
 * Custom Select Logic
 */
let isGlobalListenerAttached = false

export function setupCustomSelects(): void {
    const wrappers = document.querySelectorAll(".custom-select-wrapper")

    wrappers.forEach((wrapper) => {
        if (wrapper.getAttribute("data-listeners-attached") === "true") return
        wrapper.setAttribute("data-listeners-attached", "true")

        const trigger = wrapper.querySelector(".custom-select-trigger")
        const options = wrapper.querySelectorAll(".custom-option")
        const settingKey = (wrapper as HTMLElement).dataset.setting

        if (!trigger || !settingKey) return

        // Toggle open/close
        trigger.addEventListener("click", (e) => {
            e.stopPropagation() // Prevent immediate closing
            // Close other selects
            document.querySelectorAll(".custom-select-wrapper.open").forEach((other) => {
                if (other !== wrapper) other.classList.remove("open")
            })
            wrapper.classList.toggle("open")
        })

        // Option selection
        options.forEach((option) => {
            option.addEventListener("click", async (e) => {
                e.stopPropagation()
                const value = (option as HTMLElement).dataset.value
                if (!value) return

                // Update UI
                updateCustomSelectUI(wrapper as HTMLElement, value)
                wrapper.classList.remove("open")

                // Dispatch change event for preview updates
                const changeEvent = new CustomEvent("settingChange", {
                    detail: { key: settingKey, value },
                })
                document.dispatchEvent(changeEvent)

                // Save setting
                await saveSetting(settingKey as keyof types.UserSettings, value)
            })
        })
    })

    // Click outside to close
    if (!isGlobalListenerAttached) {
        document.addEventListener("click", () => {
            document.querySelectorAll(".custom-select-wrapper.open").forEach((wrapper) => {
                wrapper.classList.remove("open")
            })
        })
        isGlobalListenerAttached = true
    }
}

function updateCustomSelectUI(wrapper: HTMLElement, value: string): void {
    const trigger = wrapper.querySelector(".custom-select-trigger")
    if (!trigger) return

    const selectedOption = wrapper.querySelector(`.custom-option[data-value="${value}"]`)
    if (!selectedOption) return

    // Update trigger content
    const previewDot = trigger.querySelector(".color-dot") as HTMLElement
    const label = trigger.querySelector(".color-name") as HTMLElement
    
    const optionDot = selectedOption.querySelector(".color-dot") as HTMLElement
    const optionLabel = selectedOption.querySelector("span[data-i18n-key]") as HTMLElement
    
    if (previewDot && optionDot) {
        previewDot.style.backgroundColor = optionDot.style.backgroundColor
    }
    
    if (label && optionLabel) {
        const key = optionLabel.getAttribute("data-i18n-key")
        if (key) {
             label.textContent = i18nModule.translate(key)
             label.setAttribute("data-i18n-key", key)
        } else {
             label.textContent = optionLabel.textContent
        }
    }

    // Store value in dataset for easy retrieval
    wrapper.dataset.value = value

    // Highlight selected option
    wrapper.querySelectorAll(".custom-option").forEach(opt => opt.classList.remove("selected"))
    selectedOption.classList.add("selected")
}


/**
 * Animate the provider-panels container to a target height, then clear inline style.
 */
function animateContainerHeight(container: HTMLElement, targetHeight: number): void {
    container.style.height = `${targetHeight}px`
    const onEnd = (): void => {
        // Only clear if height hasn't changed mid-animation (not interrupted)
        if (container.style.height === `${targetHeight}px`) {
            if (targetHeight === 0) {
                // Collapsed — CSS default height:0 is correct, can clear
                container.style.height = ""
            }
            // If expanded, leave the explicit pixel height so the absolutely-positioned
            // panels remain visible. Height will be updated on next provider switch.
        }
        container.removeEventListener("transitionend", onEnd)
    }
    container.addEventListener("transitionend", onEnd)
}

/**
 * Switch the visible provider sub-panel with a height-animated container + opacity crossfade.
 * Pass animate=false for initial render (no animation).
 */
function updateProviderDependentUI(provider: string, animate = true): void {
    const container = document.getElementById("providerPanelsContainer") as HTMLElement | null
    if (!container) {
        return
    }

    const allPanels = Array.from(container.querySelectorAll<HTMLElement>(".provider-panel"))
    const oldPanel = allPanels.find((p) => p.classList.contains("is-active")) ?? null
    const newPanel = allPanels.find((p) => p.dataset.provider === provider) ?? null

    if (oldPanel === newPanel) {
        return
    }

    if (!animate) {
        // Instant apply for initial load — no transition
        allPanels.forEach((p) => p.classList.remove("is-active"))
        if (newPanel) {
            newPanel.classList.add("is-active")
            // Set container height synchronously — skip CSS transition
            container.style.transition = "none"
            container.style.height = `${newPanel.scrollHeight + 20}px` // 20px = panel padding-top
            // Re-enable transition on next frame
            requestAnimationFrame(() => {
                container.style.transition = ""
                container.style.height = ""
            })
        } else {
            container.style.transition = "none"
            container.style.height = "0px"
            requestAnimationFrame(() => {
                container.style.transition = ""
            })
        }
        return
    }

    // Lock container at current rendered height before any DOM change
    const lockedHeight = container.offsetHeight
    container.style.height = `${lockedHeight}px`
    // Remove transition briefly so the lock is instant
    container.style.transition = "none"
    // Force reflow
    void container.offsetHeight
    container.style.transition = ""

    // Fade out old panel
    oldPanel?.classList.remove("is-active")

    if (newPanel) {
        // Measure new panel's natural height while it's transparent + absolute
        // (offsetHeight works on absolutely positioned elements regardless of opacity)
        const panelContentHeight = newPanel.scrollHeight
        const PADDING_TOP = 20 // matches .provider-panel padding-top in CSS
        const targetHeight = panelContentHeight + PADDING_TOP

        // Activate the new panel (triggers opacity + transform transition)
        newPanel.classList.add("is-active")

        // Animate container to new height
        requestAnimationFrame(() => {
            animateContainerHeight(container, targetHeight)
        })
    } else {
        // "official" has no sub-panel — collapse to 0
        requestAnimationFrame(() => {
            animateContainerHeight(container, 0)
        })
    }
}


