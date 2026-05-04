/**
 * Settings Manager for Popup
 *
 * Handles loading, saving, and updating user settings
 */

import type * as types from "@/0_common/types"
import * as i18nModule from "@/0_common/utils/i18n"
import * as languageDisplayModule from "@/0_common/utils/languageDisplay"
import * as loggerModule from "@/0_common/utils/logger"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import * as toastManagerModule from "./toastManager"

const logger = loggerModule.createLogger("Popup/Settings")
const MASTER_SECTION_OFF_CLASS = "section-master-off"

function syncMasterSectionVisualState(enabled: boolean): void {
    const masterSection = document.querySelector(".section-master")
    masterSection?.classList.toggle(MASTER_SECTION_OFF_CLASS, !enabled)
}

function updateSuppressNativeLanguageLabel(targetLanguage: string): void {
    const labelSpan = document.getElementById("suppressNativeLanguageLabel")
    if (!labelSpan) return

    const langName = languageDisplayModule.getLanguageDisplayName(targetLanguage)
    const template = i18nModule.translate("popup.suppressNativeLanguage.label")
    
    // Simple text replacement, no extra HTML styling
    labelSpan.textContent = template.replace("{language}", langName)
}

function setTranslationControlsEnabled(enabled: boolean): void {
    const dependentIds = ["showIcon", "singleClickTranslate"]

    dependentIds.forEach((id) => {
        const input = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null
        if (!input) {
            return
        }

        input.disabled = !enabled

        // For the trigger key select, it's inside a flex container, so we need to find the parent setting-item
        const settingItem = input.closest(".setting-item")
        if (settingItem) {
            settingItem.classList.toggle("is-disabled", !enabled)
        }
    })
}

async function restoreDependentTogglesIfAllOff(): Promise<void> {
    const showIconInput = document.getElementById("showIcon") as HTMLInputElement | null
    const singleClickInput = document.getElementById("singleClickTranslate") as HTMLInputElement | null

    if (!showIconInput || !singleClickInput) {
        return
    }

    const currentSettings = await storageManagerModule.getUserSettings()
    const isDoubleClickEnabled = currentSettings.doubleClickTranslateV2

    const allDisabled = !showIconInput.checked && !singleClickInput.checked && !isDoubleClickEnabled
    if (!allDisabled) {
        return
    }

    showIconInput.checked = true
    singleClickInput.checked = true

    // Atomic update to avoid concurrent overwrite
    await storageManagerModule.updateUserSettings({
        showIcon: true,
        singleClickTranslate: true,
        doubleClickTranslateV2: false,
    })
}

/**
 * Load and display current settings from storage
 */
export async function loadSettings(): Promise<void> {
    try {
        const settings = await storageManagerModule.getUserSettings()
        logger.info("Loaded settings:", settings)

        // Update dynamic label for suppressNativeLanguage
        updateSuppressNativeLanguageLabel(settings.targetLanguage)

        // Update all checkboxes
        const checkboxes = document.querySelectorAll('input[type="checkbox"][data-setting]')
        checkboxes.forEach((checkbox) => {
            const input = checkbox as HTMLInputElement
            const settingKey = input.dataset.setting as keyof types.UserSettings
            if (settingKey && settingKey in settings) {
                input.checked = settings[settingKey] as boolean
            }
        })

        // Update select elements
        const selects = document.querySelectorAll("select[data-setting]")
        selects.forEach((select) => {
            const selectElement = select as HTMLSelectElement
            const settingKey = selectElement.dataset.setting as keyof types.UserSettings
            if (settingKey && settingKey in settings) {
                // Convert to string for select value assignment
                selectElement.value = String(settings[settingKey])
            }
        })

        // Apply master toggle effect to dependent controls
        setTranslationControlsEnabled(settings.enableTapWord)
        syncMasterSectionVisualState(settings.enableTapWord)

    } catch (error) {
        logger.error("Failed to load settings:", error)
    }
}

/**
 * Save a single setting change to storage
 */
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

/**
 * Set up change listeners for all setting controls (checkboxes and selects)
 */
export function setupSettingChangeListeners(): void {
    // Add change listeners to all checkboxes
    const checkboxes = document.querySelectorAll('input[type="checkbox"][data-setting]')
    checkboxes.forEach((checkbox) => {
        checkbox.addEventListener("change", async (event) => {
            const input = event.target as HTMLInputElement
            const settingKey = input.dataset.setting as keyof types.UserSettings
            if (settingKey) {
                // Keep mutual exclusion in data model even after removing double-click toggle from popup
                if (settingKey === "singleClickTranslate" && input.checked) {
                    await saveSetting("doubleClickTranslateV2", false)
                }

                await saveSetting(settingKey, input.checked)

                if (settingKey === "enableTapWord") {
                    setTranslationControlsEnabled(input.checked)
                    syncMasterSectionVisualState(input.checked)
                    if (input.checked) {
                        await restoreDependentTogglesIfAllOff()
                    }
                }

            }
        })
    })

    // Add change listeners to all select elements
    const selects = document.querySelectorAll("select[data-setting]")
    selects.forEach((select) => {
        select.addEventListener("change", async (event) => {
            const selectElement = event.target as HTMLSelectElement
            const settingKey = selectElement.dataset.setting as keyof types.UserSettings
            if (settingKey) {
                const value = selectElement.value

                if (settingKey === "targetLanguage") {
                    updateSuppressNativeLanguageLabel(value)
                }

                await saveSetting(settingKey, value)

                // Show refresh reminder toast for translation font size preset change
                if (settingKey === "translationFontSizePresetV2") {
                    const message = i18nModule.translate("popup.refreshReminder")
                    toastManagerModule.showToast(message, "info")
                }
            }
        })
    })
}