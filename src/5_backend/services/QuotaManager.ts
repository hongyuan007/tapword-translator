/**
 * Quota Manager Service
 *
 * Tracks and enforces daily usage quotas for translations and speech synthesis.
 *
 * Features:
 * 1. Track successful translation requests (word + fragment)
 * 2. Track successful speech synthesis requests
 * 3. Check against daily quotas from ConfigService
 * 4. Auto-reset counts daily at midnight
 * 5. Persist counts in chrome.storage.local
 *
 * Note: Quota checks are disabled for community edition builds
 */

import { APP_EDITION } from "@/0_common/constants"
import { QuotaExceededError } from "@/0_common/types"
import { createLogger } from "@/0_common/utils/logger"
import { getConfigService } from "./ConfigService"

const logger = createLogger("QuotaManager")

const TRANSLATE_ERROR_MSG = "翻译额度用光了, 明天再来吧"
const SPEECH_ERROR_MSG = "语音额度用光了, 明天再来吧"

/**
 * Storage key for quota tracking data
 */
const QUOTA_STORAGE_KEY = "quotaUsage"

/**
 * Quota usage data structure
 */
interface QuotaUsageData {
    /** Date string in YYYY-MM-DD format */
    date: string
    /** Number of successful translation requests today */
    translationCount: number
    /** Number of successful speech synthesis requests today */
    speechCount: number
}

/**
 * Get today's date string in YYYY-MM-DD format
 */
function getTodayDateString(): string {
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, "0")
    const day = String(now.getDate()).padStart(2, "0")
    return `${year}-${month}-${day}`
}

/**
 * Quota Manager Service Class
 */
export class QuotaManager {
    private currentData: QuotaUsageData | null = null
    private isInitialized: boolean = false
    private initializePromise: Promise<void> | null = null

    /**
     * Initialize the quota manager
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) {
            return
        }

        if (this.initializePromise) {
            await this.initializePromise
            return
        }

        this.initializePromise = (async () => {
            logger.info("Initializing QuotaManager...")
            await this.loadQuotaData()
            this.isInitialized = true
            logger.info("QuotaManager initialized successfully")
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
     * Check if translation quota is available
     * @throws QuotaExceededError if quota is exceeded
     *
     * Note: Always passes for community edition (no quota enforcement)
     */
    async checkTranslationQuota(): Promise<void> {
        // Community edition: skip quota check (users use their own API keys)
        if (APP_EDITION === "community") {
            logger.debug("Community edition: skipping translation quota check")
            return
        }

        await this.ensureInitialized()
        await this.ensureDataIsToday()

        const configService = getConfigService()
        await configService.ensureCacheLoaded()
        const dailyLimit = configService.getDailyFreeTranslations()
        const currentCount = this.currentData?.translationCount || 0

        logger.debug(`Translation quota check: ${currentCount}/${dailyLimit}`)

        if (currentCount >= dailyLimit) {
            logger.warn("Translation quota exceeded:", currentCount, ">=", dailyLimit)
            throw new QuotaExceededError("translation", TRANSLATE_ERROR_MSG)
        }
    }

    /**
     * Check if speech synthesis quota is available
     * @throws QuotaExceededError if quota is exceeded
     *
     * Note: Always passes for community edition (no quota enforcement)
     */
    async checkSpeechQuota(): Promise<void> {
        // Community edition: skip quota check (users use their own API keys)
        if (APP_EDITION === "community") {
            logger.debug("Community edition: skipping speech quota check")
            return
        }

        await this.ensureInitialized()
        await this.ensureDataIsToday()

        const configService = getConfigService()
        await configService.ensureCacheLoaded()
        const dailyLimit = configService.getDailyFreeSpeech()
        const currentCount = this.currentData?.speechCount || 0

        logger.debug(`Speech quota check: ${currentCount}/${dailyLimit}`)

        if (currentCount >= dailyLimit) {
            logger.warn("Speech quota exceeded:", currentCount, ">=", dailyLimit)
            throw new QuotaExceededError("speech", SPEECH_ERROR_MSG)
        }
    }

    /**
     * Increment translation count (call after successful translation)
     */
    async incrementTranslationCount(): Promise<void> {
        await this.ensureInitialized()
        await this.ensureDataIsToday()

        if (!this.currentData) {
            logger.error("Cannot increment: currentData is null")
            return
        }

        this.currentData.translationCount++
        await this.saveQuotaData()

        logger.debug("Translation count incremented:", this.currentData.translationCount)
    }

    /**
     * Increment speech synthesis count (call after successful speech synthesis)
     */
    async incrementSpeechCount(): Promise<void> {
        await this.ensureInitialized()
        await this.ensureDataIsToday()

        if (!this.currentData) {
            logger.error("Cannot increment: currentData is null")
            return
        }

        this.currentData.speechCount++
        await this.saveQuotaData()

        logger.debug("Speech count incremented:", this.currentData.speechCount)
    }

    /**
     * Get current quota usage (for debugging/UI display)
     */
    async getQuotaUsage(): Promise<{ translation: number; speech: number }> {
        await this.ensureInitialized()
        await this.ensureDataIsToday()

        return {
            translation: this.currentData?.translationCount || 0,
            speech: this.currentData?.speechCount || 0,
        }
    }

    /**
     * Load quota data from chrome.storage.local
     */
    private async loadQuotaData(): Promise<void> {
        try {
            const result = await chrome.storage.local.get(QUOTA_STORAGE_KEY)
            const stored = result[QUOTA_STORAGE_KEY] as QuotaUsageData | undefined

            const today = getTodayDateString()

            if (stored && stored.date === today) {
                // Use existing data for today
                this.currentData = stored
                logger.info("Loaded quota data for today:", stored)
            } else {
                // Reset for new day
                this.currentData = {
                    date: today,
                    translationCount: 0,
                    speechCount: 0,
                }
                await this.saveQuotaData()
                logger.info("Initialized new quota data for today")
            }
        } catch (error) {
            logger.error("Failed to load quota data:", error)
            // Initialize with empty data
            this.currentData = {
                date: getTodayDateString(),
                translationCount: 0,
                speechCount: 0,
            }
        }
    }

    /**
     * Save quota data to chrome.storage.local
     */
    private async saveQuotaData(): Promise<void> {
        if (!this.currentData) {
            logger.error("Cannot save: currentData is null")
            return
        }

        try {
            await chrome.storage.local.set({
                [QUOTA_STORAGE_KEY]: this.currentData,
            })
            logger.debug("Quota data saved to storage")
        } catch (error) {
            logger.error("Failed to save quota data:", error)
        }
    }

    private async ensureInitialized(): Promise<void> {
        if (this.isInitialized) {
            return
        }

        await this.initialize()
    }

    /**
     * Ensure current data is for today (reset if date changed)
     */
    private async ensureDataIsToday(): Promise<void> {
        const today = getTodayDateString()

        if (!this.currentData || this.currentData.date !== today) {
            logger.info("Date changed, resetting quota data")
            this.currentData = {
                date: today,
                translationCount: 0,
                speechCount: 0,
            }
            await this.saveQuotaData()
        }
    }
}

/**
 * Default QuotaManager instance (singleton)
 */
let defaultQuotaManager: QuotaManager | null = null

/**
 * Get the default QuotaManager instance
 */
export function getQuotaManager(): QuotaManager {
    if (!defaultQuotaManager) {
        defaultQuotaManager = new QuotaManager()
    }
    return defaultQuotaManager
}

/**
 * Initialize the default QuotaManager
 */
export async function initQuotaManager(): Promise<void> {
    const manager = getQuotaManager()
    await manager.initialize()
}
