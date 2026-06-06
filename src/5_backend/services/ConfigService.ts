/**
 * Cloud Configuration Service
 *
 * Manages fetching, caching, and auto-refreshing of cloud configuration.
 *
 * Features:
 * 1. Fetch cloud config from /api/v1/config (no authentication required)
 * 2. Cache config in memory and chrome.storage.local for persistence
 * 3. Auto-refresh config at configurable intervals (default: 24 hours)
 * 4. Provide synchronous access to cached config
 * 5. Handle network failures gracefully (use cached config as fallback)
 */

import { createLogger } from "@/0_common/utils/logger"
import * as storageManager from "@/0_common/utils/storageManager"
import { CLIENT_VERSION } from "../constants"
import type { CloudConfig } from "../types/ConfigTypes"
import { getAPIService } from "./APIService"

const logger = createLogger("ConfigService")

/**
 * Default configuration values (fallback when fetch fails)
 */
const DEFAULT_CONFIG: CloudConfig = {
    quota: {
        dailyFreeTranslations: 100, // Conservative default
        dailyFreeSpeech: 300, // Conservative default
        dailyFreeFullTextTranslationChars: 20000, // ~2–6 pages per day
    },
    websiteUrl: "www.tapword.cc", // Default official website
    chromeExtensionVersion: CLIENT_VERSION, // Default version
}

/**
 * Cloud Configuration Service Class
 */
export class ConfigService {
    private configEndpoint: string = ""
    private refreshIntervalMs: number = 0
    private autoRefreshTimer: NodeJS.Timeout | null = null
    private currentConfig: CloudConfig | null = null
    private cacheLoadPromise: Promise<void> | null = null
    private fetchPromise: Promise<CloudConfig> | null = null
    private initializePromise: Promise<void> | null = null
    private isInitialized: boolean = false

    /**
     * Initialize the config service
     *
     * @param configEndpoint - Config endpoint path (default: /api/v1/config)
     * @param refreshIntervalMs - Auto-refresh interval in milliseconds (default: 24 hours)
     */
    async initialize(
        configEndpoint: string = "/api/v1/config",
        refreshIntervalMs: number = 24 * 60 * 60 * 1000 // 24 hours
    ): Promise<void> {
        if (this.isInitialized) {
            return
        }

        if (this.initializePromise) {
            await this.initializePromise
            return
        }

        this.initializePromise = (async () => {
            logger.info("Initializing ConfigService...")
            logger.info("Config endpoint:", configEndpoint)
            logger.info("Refresh interval:", Math.floor(refreshIntervalMs / 1000 / 60), "minutes")

            this.configEndpoint = configEndpoint
            this.refreshIntervalMs = refreshIntervalMs
            this.isInitialized = true

            // Load cached config from storage before exposing synchronous readers.
            await this.ensureCacheLoaded()

            // Start auto-refresh timer
            this.startAutoRefresh()

            // Fetch fresh config from cloud in the background. Cold-start request paths
            // should rely on cached/default config and not wait for this network call.
            void this.fetchConfig()
                .then(() => {
                    logger.info("Initial config fetch completed")
                })
                .catch((error) => {
                    logger.error("Initial config fetch failed, using cached or default config:", error)
                })

            logger.info("ConfigService initialized successfully")
        })()

        try {
            await this.initializePromise
        } finally {
            this.initializePromise = null
        }
    }

    /**
     * Check if the service is initialized
     */
    isReady(): boolean {
        return this.isInitialized
    }

    /**
     * Ensure cached/default config is materialized in memory.
     * This is safe to call before full service initialization.
     */
    async ensureCacheLoaded(): Promise<void> {
        if (this.currentConfig) {
            return
        }

        if (this.cacheLoadPromise) {
            await this.cacheLoadPromise
            return
        }

        this.cacheLoadPromise = this.loadCachedConfig()

        try {
            await this.cacheLoadPromise
        } finally {
            this.cacheLoadPromise = null
        }
    }

    /**
     * Get current config (synchronous)
     * Returns cached config immediately, or default config if not available
     */
    getConfig(): CloudConfig {
        if (this.currentConfig) {
            // Return a deep copy to prevent external modifications
            return {
                quota: {
                    ...this.currentConfig.quota,
                },
                websiteUrl: this.currentConfig.websiteUrl,
                chromeExtensionVersion: this.currentConfig.chromeExtensionVersion,
            }
        }
        logger.warn("No cached config available, using default config")
        return {
            quota: {
                ...DEFAULT_CONFIG.quota,
            },
            websiteUrl: DEFAULT_CONFIG.websiteUrl,
            chromeExtensionVersion: DEFAULT_CONFIG.chromeExtensionVersion,
        }
    }

    /**
     * Get a specific quota value
     */
    getDailyFreeTranslations(): number {
        return this.getConfig().quota.dailyFreeTranslations
    }

    /**
     * Get daily free speech synthesis quota
     */
    getDailyFreeSpeech(): number {
        return this.getConfig().quota.dailyFreeSpeech
    }

    /**
     * Get daily free full-text translation character quota
     */
    getDailyFreeFullTextTranslationChars(): number {
        return this.getConfig().quota.dailyFreeFullTextTranslationChars
    }

    /**
     * Get official website URL
     */
    getOfficialWebsite(): string {
        return this.getConfig().websiteUrl
    }

    /**
     * Get Chrome extension version from cloud config
     */
    getChromeExtensionVersion(): string {
        return this.getConfig().chromeExtensionVersion
    }

    /**
     * Force refresh config from cloud
     */
    async refreshConfig(): Promise<CloudConfig> {
        logger.info("Forcing config refresh...")
        return await this.fetchConfig()
    }

    /**
     * Shutdown the service (stop auto-refresh)
     */
    shutdown(): void {
        logger.info("Shutting down ConfigService...")
        this.stopAutoRefresh()
        this.isInitialized = false
        this.initializePromise = null
    }

    /**
     * Load cached config from chrome.storage.local
     */
    private async loadCachedConfig(): Promise<void> {
        try {
            const cached = await storageManager.getCachedCloudConfig(CLIENT_VERSION)

            if (cached) {
                this.currentConfig = cached
                logger.info("Loaded cached config from storage")
            } else {
                logger.info("No valid cached config found")
            }
        } catch (error) {
            logger.error("Failed to load cached config:", error)
        }

        // If no cached config, use default
        if (!this.currentConfig) {
            this.currentConfig = { ...DEFAULT_CONFIG }
            logger.info("Using default config")
        }
    }

    /**
     * Save config to chrome.storage.local
     */
    private async saveConfigToStorage(config: CloudConfig): Promise<void> {
        try {
            await storageManager.saveCachedCloudConfig(config, CLIENT_VERSION)
            logger.debug("Config saved to storage")
        } catch (error) {
            logger.error("Failed to save config to storage:", error)
        }
    }

    /**
     * Fetch config from cloud API
     */
    private async fetchConfig(): Promise<CloudConfig> {
        if (!this.isInitialized) {
            throw new Error("ConfigService not initialized")
        }

        // If a fetch is already in progress, wait for it
        if (this.fetchPromise) {
            logger.info("Config fetch already in progress, waiting...")
            return await this.fetchPromise
        }

        // Start a new fetch
        logger.info("Fetching cloud config...")
        this.fetchPromise = this.performFetch()

        try {
            const config = await this.fetchPromise
            return config
        } finally {
            this.fetchPromise = null
        }
    }

    /**
     * Perform the actual HTTP fetch using APIService
     */
    private async performFetch(): Promise<CloudConfig> {
        logger.info("Fetching from:", this.configEndpoint)

        try {
            // Use APIService's request method with addAuthToken: false (no auth required for config endpoint)
            const apiService = getAPIService()
            const config = await apiService.request<CloudConfig>(this.configEndpoint, "GET", undefined, { addAuthToken: false })

            // Validate config structure (quota, websiteUrl, and chromeExtensionVersion are required)
            if (!config.quota || typeof config.quota.dailyFreeTranslations !== "number" || typeof config.quota.dailyFreeSpeech !== "number") {
                logger.error("Invalid config structure: missing or invalid quota", config)
                throw new Error("Invalid config structure: quota is invalid")
            }

            if (!config.websiteUrl || typeof config.websiteUrl !== "string") {
                logger.error("Invalid config structure: missing or invalid websiteUrl", config)
                throw new Error("Invalid config structure: websiteUrl is invalid")
            }

            if (!config.chromeExtensionVersion || typeof config.chromeExtensionVersion !== "string") {
                logger.error("Invalid config structure: missing or invalid chromeExtensionVersion", config)
                throw new Error("Invalid config structure: chromeExtensionVersion is invalid")
            }

            // Update current config
            this.currentConfig = config
            logger.info("Cloud config fetched successfully")
            logger.info("Daily free translations:", config.quota.dailyFreeTranslations)
            logger.info("Daily free speech:", config.quota.dailyFreeSpeech)
            logger.info("Website URL:", config.websiteUrl)
            logger.info("Chrome extension version:", config.chromeExtensionVersion)

            // Save to storage
            await this.saveConfigToStorage(config)

            return config
        } catch (error) {
            logger.error("Failed to fetch cloud config:", error)
            // Return current config (cached or default) as fallback
            if (this.currentConfig) {
                logger.info("Using cached config as fallback")
                return this.currentConfig
            }
            throw error
        }
    }

    /**
     * Start automatic config refresh timer
     */
    private startAutoRefresh(): void {
        // Clear any existing timer
        this.stopAutoRefresh()

        const intervalMinutes = Math.floor(this.refreshIntervalMs / 1000 / 60)
        logger.info(`Starting auto-refresh timer (interval: ${intervalMinutes} minutes)`)

        // Set up periodic refresh
        this.autoRefreshTimer = setInterval(async () => {
            if (!this.isInitialized) {
                logger.warn("ConfigService not initialized, skipping auto-refresh")
                return
            }

            try {
                logger.info("Auto-refresh timer triggered, fetching config...")
                await this.fetchConfig()
                logger.info("Auto-refresh completed successfully")
            } catch (error) {
                logger.error("Auto-refresh failed:", error)
                // Non-critical error, will retry on next interval
            }
        }, this.refreshIntervalMs)

        logger.debug("Auto-refresh timer started")
    }

    /**
     * Stop automatic config refresh timer
     */
    private stopAutoRefresh(): void {
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer)
            this.autoRefreshTimer = null
            logger.debug("Auto-refresh timer stopped")
        }
    }
}

/**
 * Default ConfigService instance (singleton)
 */
let defaultConfigService: ConfigService | null = null

/**
 * Get the default ConfigService instance
 */
export function getConfigService(): ConfigService {
    if (!defaultConfigService) {
        defaultConfigService = new ConfigService()
    }
    return defaultConfigService
}

/**
 * Initialize the default ConfigService
 *
 * @param configEndpoint - Config endpoint path (default: /api/v1/config)
 * @param refreshIntervalMs - Auto-refresh interval in milliseconds (default: 24 hours)
 */
export async function initConfigService(configEndpoint?: string, refreshIntervalMs?: number): Promise<void> {
    const service = getConfigService()
    await service.initialize(configEndpoint, refreshIntervalMs)
}
