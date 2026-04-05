/**
 * Storage Manager Utility
 *
 * Responsibilities:
 * 1. Provide high-level API for chrome.storage operations
 * 2. Handle settings persistence (API keys, preferences, etc.)
 * 3. Manage translation cache storage
 * 4. Implement data migration between versions
 * 5. Provide default values for uninitialized settings
 * 6. Handle storage quota management
 * 7. Implement data export/import functionality
 * 8. Ensure data security for sensitive information
 */

import { APP_EDITION } from "@/0_common/constants"
import type * as types from "@/0_common/types"
import { DEFAULT_USER_SETTINGS } from "@/0_common/types"
import * as translationFontSizeModule from "@/0_common/constants/translationFontSize"
import type { CachedConfig, CloudConfig } from "@/5_backend/types/ConfigTypes"
import * as loggerModule from "@/0_common/utils/logger"
import { getPlatformOS, PLATFORMS } from "@/0_common/utils/platformDetector"
import type { PlatformOS } from "@/0_common/utils/platformDetector"

const logger = loggerModule.createLogger("0_common/utils/storageManager")
const isCommunityEdition = APP_EDITION === "community"

const STORAGE_KEYS = {
    USER_SETTINGS: "userSettings",
    DEVICE_UID: "deviceUid",
    CLOUD_CONFIG: "cloudConfig",
} as const

const ALLOWED_TRIGGER_KEYS: types.TriggerKey[] = ["meta", "option", "alt", "ctrl"]
const VALID_PROFICIENCY_LEVELS: types.LanguageProficiency[] = ["Beginner", "Intermediate", "Advanced"]

type PlatformDefaultContext = {
    os: PlatformOS
    defaultTriggerKey: types.TriggerKey
}

async function getPlatformDefaults(): Promise<PlatformDefaultContext> {
    try {
        const os = await getPlatformOS()
        if (os === PLATFORMS.MAC) {
            return { os, defaultTriggerKey: "meta" }
        }
        return { os, defaultTriggerKey: "alt" }
    } catch (error) {
        logger.warn("Platform detection failed, using default trigger key:", error)
        return { os: "unknown", defaultTriggerKey: "alt" }
    }
}

/**
 * Validate and normalize trigger key based on platform constraints
 */
function normalizeTriggerKey(key: types.TriggerKey, os: PlatformOS): types.TriggerKey {
    let normalizedKey = key

    if (os === PLATFORMS.MAC) {
        // Mac: 'alt' means 'option' in legacy data
        if (normalizedKey === "alt") {
            normalizedKey = "option"
        }
        // Mac: 'ctrl' conflicts with context menu, force fallback to default 'meta'
        if (normalizedKey === "ctrl") {
            normalizedKey = "meta"
        }
    } else {
        // Windows/Linux/Other: 'meta' (Win key) is reserved/unusable, 'option' is invalid
        if (normalizedKey === "meta" || normalizedKey === "option") {
            normalizedKey = "alt"
        }
    }

    return normalizedKey
}

// TODO: Add unit tests for this function to cover data migration and platform-specific defaults, as logic is becoming complex.
function normalizeUserSettings(
    settings: Partial<types.UserSettings>,
    platformDefaults?: PlatformDefaultContext
): types.UserSettings {
    const normalizeString = (value: string | undefined): string => (value ?? "").trim()

    const mergedCustomApi = {
        ...DEFAULT_USER_SETTINGS.customApi,
        ...(settings.customApi ?? {}),
    }

    const mergedMTranserver = {
        ...DEFAULT_USER_SETTINGS.mtranserver,
        ...(settings.mtranserver ?? {}),
    }

    const mergedBingTranslate = {
        ...DEFAULT_USER_SETTINGS.bingTranslate,
        ...(settings.bingTranslate ?? {}),
    }

    const mergedAgentSettings: types.AgentSettings = {
        ...DEFAULT_USER_SETTINGS.agentSettings,
        ...(settings.agentSettings ?? {}),
    }

    const normalizedCustomApi: types.CustomApiSettings = {
        baseUrl: normalizeString(mergedCustomApi.baseUrl),
        apiKey: normalizeString(mergedCustomApi.apiKey),
        model: normalizeString(mergedCustomApi.model),
    }

    const normalizedMTranserver: types.MTranserverSettings = {
        url: normalizeString(mergedMTranserver.url),
        key: normalizeString(mergedMTranserver.key),
        enabled: mergedMTranserver.enabled ?? DEFAULT_USER_SETTINGS.mtranserver.enabled,
    }

    // Community edition: Default to customApi since official cloud API is not available
    let normalizedTranslationProvider: types.TranslationProvider = "official"
    if (isCommunityEdition && settings.translationProvider === undefined) {
        normalizedTranslationProvider = "customApi"
    }
    
    // Note: We don't auto-switch to mtranserver based on URL configuration
    // User must explicitly select mtranserver from the provider dropdown

    const platformDefaultTriggerKey = platformDefaults?.defaultTriggerKey ?? DEFAULT_USER_SETTINGS.doubleClickSentenceTriggerKey
    const platformOS = platformDefaults?.os ?? "unknown"

    const platformAwareDefaults: Partial<types.UserSettings> = {
        doubleClickSentenceTriggerKey: platformDefaultTriggerKey,
    }

    const mergedSettings: types.UserSettings = {
        ...DEFAULT_USER_SETTINGS,
        ...platformAwareDefaults,
        ...settings,
        customApi: normalizedCustomApi,
        translationProvider: settings.translationProvider ?? normalizedTranslationProvider,
    }

    const triggerKey = normalizeTriggerKey(mergedSettings.doubleClickSentenceTriggerKey, platformOS)

    const validatedTriggerKey = ALLOWED_TRIGGER_KEYS.includes(triggerKey)
        ? (triggerKey as types.TriggerKey)
        : platformDefaultTriggerKey

    // [Migration Logic]
    // Case 1: Legacy User Migration (Has 'doubleClickTranslate', Missing 'doubleClickTranslateV2')
    //         - We DO NOT respect their explicit choice for double-click.
    //         - We enforce new defaults: DoubleV2=FALSE, Single=TRUE.
    //         - This ensures a consistent experience for everyone moving to V2.
    // Case 2: Fresh Install / Post-Migration
    //         - 'mergedSettings' already contains correct defaults or updated values.
    //         - Default is Single=TRUE, DoubleV2=FALSE.

    const resolvedFont = translationFontSizeModule.resolveTranslationFontSize(mergedSettings.translationFontSizePreset)

    return {
        ...mergedSettings,
        translationFontSizePreset: resolvedFont.preset,
        translationFontSize: resolvedFont.px,
        tooltipNextLineGapPx: mergedSettings.tooltipNextLineGapPx ?? DEFAULT_USER_SETTINGS.tooltipNextLineGapPx,
        tooltipNextLineGapPxV2: mergedSettings.tooltipNextLineGapPxV2 ?? DEFAULT_USER_SETTINGS.tooltipNextLineGapPxV2,
        tooltipVerticalOffsetPx: mergedSettings.tooltipVerticalOffsetPx ?? DEFAULT_USER_SETTINGS.tooltipVerticalOffsetPx,
        tooltipVerticalOffsetPxV2: mergedSettings.tooltipVerticalOffsetPxV2 ?? DEFAULT_USER_SETTINGS.tooltipVerticalOffsetPxV2,
        textUnderlineOffsetPx: mergedSettings.textUnderlineOffsetPx ?? DEFAULT_USER_SETTINGS.textUnderlineOffsetPx,
        textUnderlineOffsetPxV2: mergedSettings.textUnderlineOffsetPxV2 ?? DEFAULT_USER_SETTINGS.textUnderlineOffsetPxV2,
        tooltipUnderlineOffsetPxV3: mergedSettings.tooltipUnderlineOffsetPxV3 ?? DEFAULT_USER_SETTINGS.tooltipUnderlineOffsetPxV3,
        tooltipTextOffsetPxV3: mergedSettings.tooltipTextOffsetPxV3 ?? DEFAULT_USER_SETTINGS.tooltipTextOffsetPxV3,
        tooltipBottomSpacingPxV3: mergedSettings.tooltipBottomSpacingPxV3 ?? DEFAULT_USER_SETTINGS.tooltipBottomSpacingPxV3,
        customApi: normalizedCustomApi,
        mtranserver: normalizedMTranserver,
        bingTranslate: mergedBingTranslate,
        doubleClickSentenceTriggerKey: validatedTriggerKey,
        // Ensure V2 key is always populated for internal usage
        doubleClickTranslateV2: mergedSettings.doubleClickTranslateV2 ?? DEFAULT_USER_SETTINGS.doubleClickTranslateV2,
        // Auto-translation settings with validation
        enableAutoTranslate: mergedSettings.enableAutoTranslate ?? DEFAULT_USER_SETTINGS.enableAutoTranslate,
        userLanguageProficiency: VALID_PROFICIENCY_LEVELS.includes(mergedSettings.userLanguageProficiency)
            ? mergedSettings.userLanguageProficiency
            : DEFAULT_USER_SETTINGS.userLanguageProficiency,
        // Chat Assistant settings with safe defaults for existing users
        enableChatAssistant: mergedSettings.enableChatAssistant ?? DEFAULT_USER_SETTINGS.enableChatAssistant,
        agentSettings: mergedAgentSettings,
    }
}

/**
 * Promise wrapper for chrome.storage.sync.get with runtime error capture
 */
async function getFromSync<T extends object>(key: string): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        try {
            chrome.storage.sync.get(key, (result) => {
                const runtimeErr = chrome.runtime?.lastError
                if (runtimeErr) {
                    reject(runtimeErr)
                    return
                }
                resolve(result as T)
            })
        } catch (err) {
            reject(err)
        }
    })
}

/**
 * Promise wrapper for chrome.storage.sync.set with runtime error capture
 */
async function setToSync(payload: Record<string, unknown>): Promise<void> {
    return await new Promise<void>((resolve, reject) => {
        try {
            chrome.storage.sync.set(payload, () => {
                const runtimeErr = chrome.runtime?.lastError
                if (runtimeErr) {
                    reject(runtimeErr)
                    return
                }
                resolve()
            })
        } catch (err) {
            reject(err)
        }
    })
}

/**
 * Get user settings from storage
 * For new users, detects browser language and sets appropriate default targetLanguage
 */
export async function getUserSettings(): Promise<types.UserSettings> {
    try {
        const platformDefaults = await getPlatformDefaults()
        const result = await getFromSync<Record<string, unknown>>(STORAGE_KEYS.USER_SETTINGS)
        const storedSettings = result[STORAGE_KEYS.USER_SETTINGS] as Partial<types.UserSettings> | undefined

        // If no stored settings exist, this is a new user
        if (!storedSettings) {
            const browserLang = detectBrowserLanguage()
            const defaultSettings = normalizeUserSettings({ targetLanguage: browserLang }, platformDefaults)
            logger.info("New user detected, setting default targetLanguage to:", browserLang)

            await saveUserSettings(defaultSettings)
            return defaultSettings
        }

        return normalizeUserSettings(storedSettings, platformDefaults)
    } catch (error) {
        logger.error("Failed to get user settings:", error)
        const platformDefaults = await getPlatformDefaults()
        return normalizeUserSettings({}, platformDefaults)
    }
}

/**
 * Detect browser language and map to supported target language
 * Supported languages: zh, en, ja, ko, fr, es, ru
 * @returns Language code for target language
 */
function detectBrowserLanguage(): string {
    const SUPPORTED_LANGUAGES = ["en", "zh", "es", "ja", "fr", "de", "ko", "ru"]

    // Get browser language (e.g., "zh-CN", "en-US", "ja")
    // Use optional chaining and nullish coalescing for safe access
    const browserLang = navigator.language || navigator.languages?.[0] || "en"

    // Extract primary language code (before hyphen)
    const parts = browserLang.split("-")
    const primaryLang = parts[0]?.toLowerCase() || "en"

    // Check if primary language is in supported list
    if (SUPPORTED_LANGUAGES.includes(primaryLang)) {
        logger.info("Browser language matched:", primaryLang)
        return primaryLang
    }

    // Default to English if no match
    logger.info("Browser language not matched, defaulting to 'en'")
    return "en"
}

/**
 * Save user settings to storage
 */
export async function saveUserSettings(settings: types.UserSettings): Promise<void> {
    try {
        const platformDefaults = await getPlatformDefaults()
        const normalizedSettings = normalizeUserSettings(settings, platformDefaults)
        await setToSync({
            [STORAGE_KEYS.USER_SETTINGS]: normalizedSettings,
        })
    } catch (error) {
        logger.error("Failed to save user settings:", error)
    }
}

/**
 * Update partial user settings
 */
export async function updateUserSettings(partialSettings: Partial<types.UserSettings>): Promise<types.UserSettings> {
    const currentSettings = await getUserSettings()
    const platformDefaults = await getPlatformDefaults()
    const updatedSettings = normalizeUserSettings(
        {
            ...currentSettings,
            ...partialSettings,
        },
        platformDefaults
    )
    await saveUserSettings(updatedSettings)
    return updatedSettings
}

/**
 * Reset user settings to defaults
 */
export async function resetUserSettings(): Promise<void> {
    await saveUserSettings(DEFAULT_USER_SETTINGS)
}

/**
 * Get or generate device UID
 * The UID is a unique identifier for this browser instance
 */
export async function getDeviceUID(): Promise<string> {
    try {
        const result = await chrome.storage.local.get(STORAGE_KEYS.DEVICE_UID)
        let uid = result[STORAGE_KEYS.DEVICE_UID] as string | undefined

        if (!uid) {
            // Generate a new UID: extension-{random-hex}
            const randomBytes = new Uint8Array(8)
            crypto.getRandomValues(randomBytes)
            const hexString = Array.from(randomBytes)
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")
            uid = `extension-${hexString}`

            // Save it for future use
            await chrome.storage.local.set({
                [STORAGE_KEYS.DEVICE_UID]: uid,
            })

            logger.info("Generated new device UID:", uid)
        }

        return uid
    } catch (error) {
        logger.error("Failed to get/generate device UID:", error)
        // Fallback: generate a temporary UID (not persisted)
        const timestamp = Date.now().toString(36)
        const random = Math.random().toString(36).substring(2, 10)
        return `extension-temp-${timestamp}${random}`
    }
}

/**
 * Save cached cloud config to chrome.storage.local
 * @param config - Cloud config data to cache
 * @param clientVersion - Current client version
 */
export async function saveCachedCloudConfig(config: CloudConfig, clientVersion: string): Promise<void> {
    const cachedConfig: CachedConfig = {
        data: config,
        fetchedAt: Date.now(),
        version: clientVersion,
    }

    await chrome.storage.local.set({
        [STORAGE_KEYS.CLOUD_CONFIG]: cachedConfig,
    })
}

/**
 * Get cached cloud config from chrome.storage.local
 * Returns null if cache is invalid or version mismatch
 * @param clientVersion - Current client version for cache validation
 */
export async function getCachedCloudConfig(clientVersion: string): Promise<CloudConfig | null> {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CLOUD_CONFIG)
    const cached = result[STORAGE_KEYS.CLOUD_CONFIG] as CachedConfig | undefined

    if (!cached) {
        return null
    }

    // Invalidate cache if version mismatch
    if (cached.version !== clientVersion) {
        return null
    }

    return cached.data
}
