/**
 * Service Initializer
 *
 * Initializes all backend services required by the extension
 */

import { getDeviceUID, getUserSettings, updateUserSettings } from "@/0_common/utils/storageManager"
import * as backendModule from "@/5_backend"
import { BUILD_TIME_CREDENTIALS, hasBuildTimeCredentials } from "@/5_backend/config/credentials"
import { CLIENT_VERSION, CONFIG_ENDPOINTS, CONFIG_REFRESH_INTERVAL_MS, API_BASE_URL_MAP } from "@/5_backend/constants"
import * as loggerModule from "@/0_common/utils/logger"
import type { UserSettings } from "@/0_common/types"
import { isLikelyChineseUser } from "@/0_common/utils/regionDetector"

const logger = loggerModule.createLogger("2_background/services/ServiceInitializer")
let criticalServicesPromise: Promise<void> | null = null
let backgroundWarmUpPromise: Promise<void> | null = null

/**
 * Initialize API Service with configuration
 *
 * @remarks
 * Credentials are loaded from build-time injection (from other/key/ files)
 */
export async function initializeAPIService(): Promise<void> {
    logger.info("Initializing API Service...")

    // Check for build-time credentials
    if (hasBuildTimeCredentials()) {
        logger.info("Using build-time injected credentials")
        const credentials = {
            apiKey: BUILD_TIME_CREDENTIALS.apiKey,
            apiSecret: BUILD_TIME_CREDENTIALS.apiSecret,
        }

        // Get or generate device UID
        const deviceUID = await getDeviceUID()
        logger.info("Device UID:", deviceUID)

        // Get user settings for network region
        const settings = await getUserSettings()
        const currentBaseURL = API_BASE_URL_MAP[settings.networkRegion] || API_BASE_URL_MAP.auto
        logger.info(`Using Base URL for region ${settings.networkRegion}: ${currentBaseURL}`)

        // Determine fallback URL for auto mode
        const fallbackBaseURL = resolveFallbackBaseURL(settings)
        if (fallbackBaseURL) {
            logger.info("Auto-fallback to China Direct enabled for Chinese user")
        }

        // Initialize AuthService
        backendModule.initAuthService(credentials, deviceUID, currentBaseURL)
        logger.info("AuthService initialized")

        // Initialize APIService
        backendModule.initAPIService({
            baseURL: currentBaseURL,
            clientVersion: CLIENT_VERSION,
            fallbackBaseURL,
        })

        logger.info("API Service initialized with JWT authentication")

        // Setup listener for network region changes
        setupNetworkRegionListener(credentials, deviceUID)

        // Perform network probe for auto-fallback
        performNetworkProbe().catch((err) => logger.error("Network probe failed:", err))
    } else {
        logger.warn("No build-time credentials found. API Service not initialized.")
    }
}

function initializeCriticalServices(): Promise<void> {
    return initializeAPIService()
}

function setupNetworkRegionListener(credentials: { apiKey: string; apiSecret: string }, deviceUID: string): void {
    try {
        chrome.storage?.onChanged.addListener((changes, areaName) => {
            if (areaName === "sync" && changes.userSettings) {
                const newSettings = changes.userSettings.newValue as UserSettings
                const oldSettings = changes.userSettings.oldValue as UserSettings

                if (newSettings && newSettings.networkRegion !== oldSettings?.networkRegion) {
                    const newBaseURL = API_BASE_URL_MAP[newSettings.networkRegion] || API_BASE_URL_MAP.auto
                    const fallbackBaseURL = resolveFallbackBaseURL(newSettings)
                    logger.info(`Network region changed to ${newSettings.networkRegion}, switching to: ${newBaseURL}`)

                    try {
                        // Update APIService
                        backendModule.getAPIService().updateConfig({ baseURL: newBaseURL, fallbackBaseURL })

                        // Re-initialize AuthService with new URL
                        // This effectively clears the token and sets new base URL for auth requests
                        backendModule.initAuthService(credentials, deviceUID, newBaseURL)

                        logger.info("Network configuration updated successfully")
                    } catch (error) {
                        logger.error("Failed to update network configuration:", error)
                    }
                }
            }
        })
    } catch (error) {
        logger.warn("Failed to setup network region listener:", error)
    }
}

function resolveFallbackBaseURL(settings: UserSettings): string | undefined {
    if (settings.networkRegion !== "auto") {
        return undefined
    }

    if (isLikelyChineseUser()) {
        return API_BASE_URL_MAP.china
    }

    return undefined
}

/**
 * Initialize all services
 *
 * @remarks
 * This function should be called once when the background script loads
 */
export async function initializeServices(): Promise<void> {
    await ensureCriticalServicesReady()
    startBackgroundWarmUp()
}

export function ensureCriticalServicesReady(): Promise<void> {
    if (!criticalServicesPromise) {
        criticalServicesPromise = initializeCriticalServices().catch((error) => {
            criticalServicesPromise = null
            throw error
        })
    }

    return criticalServicesPromise
}

export function startBackgroundWarmUp(): void {
    if (backgroundWarmUpPromise) {
        return
    }

    backgroundWarmUpPromise = ensureCriticalServicesReady()
        .then(async () => {
            await Promise.allSettled([
                initializeConfigService(),
                initializeQuotaManager(),
            ])
        })
        .catch((error) => {
            logger.error("Background warm-up failed:", error)
            backgroundWarmUpPromise = null
        })
}

/**
 * Initialize Config Service
 *
 * @remarks
 * Fetches cloud configuration on first launch and sets up periodic refresh.
 * ConfigService uses APIService internally, so APIService must be initialized first.
 */
async function initializeConfigService(): Promise<void> {
    logger.info("Initializing Config Service...")

    try {
        // Initialize ConfigService with default settings
        // Note: ConfigService uses APIService internally, which already has baseURL configured
        await backendModule.initConfigService(CONFIG_ENDPOINTS.CONFIG, CONFIG_REFRESH_INTERVAL_MS)
        logger.info("Config Service initialized successfully")
    } catch (error) {
        logger.error("Failed to initialize Config Service:", error)
        // Non-critical error - extension can still work with default config
    }
}

/**
 * Initialize Quota Manager
 *
 * @remarks
 * Sets up quota tracking for translations and speech synthesis.
 * QuotaManager uses ConfigService internally, so ConfigService must be initialized first.
 */
async function initializeQuotaManager(): Promise<void> {
    logger.info("Initializing Quota Manager...")

    try {
        await backendModule.initQuotaManager()
        logger.info("Quota Manager initialized successfully")
    } catch (error) {
        logger.error("Failed to initialize Quota Manager:", error)
        // Non-critical error - extension can still work without quota tracking
    }
}

/**
 * Perform network probe to detect if fallback is needed
 *
 * Strategy:
 * 1. If user setting is 'auto' AND user is in China environment
 * 2. Probe default API (auto)
 * 3. If fail, probe China API (china)
 * 4. If China API works, auto-switch user setting to 'china'
 */
async function performNetworkProbe(): Promise<void> {
    try {
        const settings = await getUserSettings()

        // Only probe if user hasn't manually selected a region
        if (settings.networkRegion !== "auto") {
            return
        }

        if (!isLikelyChineseUser()) {
            return
        }

        logger.info("Starting network probe for auto-configuration...")

        const configUrl = `${API_BASE_URL_MAP.auto}${CONFIG_ENDPOINTS.CONFIG}`

        try {
            // Test default route with short timeout
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000)

            const response = await fetch(configUrl, {
                method: "GET",
                signal: controller.signal,
            })
            clearTimeout(timeoutId)

            if (response.ok) {
                logger.info("Default network route is healthy.")
                return
            }
        } catch (error) {
            logger.warn("Default network route failed probe:", error)
        }

        // If we reached here, default failed. Try China route.
        // Check if China URL is different from Auto URL (to avoid redundant probe)
        if (API_BASE_URL_MAP.china === API_BASE_URL_MAP.auto) {
            return
        }

        const chinaUrl = `${API_BASE_URL_MAP.china}${CONFIG_ENDPOINTS.CONFIG}`
        logger.info("Probing China Direct route...", chinaUrl)

        try {
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), 5000)

            const response = await fetch(chinaUrl, {
                method: "GET",
                signal: controller.signal,
            })
            clearTimeout(timeoutId)

            if (response.ok) {
                logger.info("China Direct route is healthy. Switching user setting.")
                // Update setting -> triggers listener -> updates APIService
                await updateUserSettings({ networkRegion: "china" })
            } else {
                logger.warn("China Direct route also failed probe.")
            }
        } catch (error) {
            logger.warn("China Direct route failed probe:", error)
        }
    } catch (error) {
        logger.error("Network probe error:", error)
    }
}
