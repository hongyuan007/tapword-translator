/**
 * Cloud Configuration Types
 *
 * Defines the structure of cloud configuration data fetched from backend
 */

/**
 * Quota configuration from cloud
 */
export interface QuotaConfig {
    /**
     * Daily free translation quota
     */
    dailyFreeTranslations: number

    /**
     * Daily free speech synthesis quota
     */
    dailyFreeSpeech: number

    /**
     * Daily free full-text translation character quota
     */
    dailyFreeFullTextTranslationChars: number
}

/**
 * Cloud configuration data structure
 * Matches the response from GET /api/v1/config
 */
export interface CloudConfig {
    /**
     * Quota-related configuration
     */
    quota: QuotaConfig

    /**
     * Official website URL
     */
    websiteUrl: string

    /**
     * Current Chrome extension version available on the server
     */
    chromeExtensionVersion: string
}

/**
 * Cached config data with metadata
 */
export interface CachedConfig {
    /**
     * The actual configuration data
     */
    data: CloudConfig

    /**
     * Timestamp when this config was fetched (milliseconds since epoch)
     */
    fetchedAt: number

    /**
     * Version identifier for cache invalidation
     */
    version: string
}
