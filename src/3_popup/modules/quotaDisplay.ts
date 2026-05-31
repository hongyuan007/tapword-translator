/**
 * Quota Display Module
 *
 * Manages the full-text translation quota progress bar in the popup.
 * Fetches usage data from the background service worker and renders
 * a visual indicator with green/orange/red color states.
 */

import type { QuotaUsageRequestMessage, QuotaUsageResponseMessage, FullTextTranslationQuotaInfo } from "@/0_common/types"
import * as i18nModule from "@/0_common/utils/i18n"
import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("Popup/QuotaDisplay")

const QUOTA_CACHE_KEY = "quotaDisplayCache"
const PERCENTAGE_WARNING_THRESHOLD = 80
const PERCENTAGE_EXHAUSTED_THRESHOLD = 100

interface QuotaDisplayCache {
    used: number
    limit: number
    remaining: number
    timestamp: number
}

// DOM element references
let progressBarFill: HTMLElement | null = null
let progressPercentage: HTMLElement | null = null
let quotaSection: HTMLElement | null = null
let fullTranslateButton: HTMLButtonElement | null = null

/**
 * Initialize the quota display.
 * Renders cached data first for instant UI, then fetches fresh data.
 */
export async function initQuotaDisplay(): Promise<void> {
    progressBarFill = document.getElementById("quotaProgressFill")
    progressPercentage = document.getElementById("quotaPercentage")
    quotaSection = document.getElementById("quotaSection")
    fullTranslateButton = document.getElementById("fullTranslateButton") as HTMLButtonElement | null

    if (!progressBarFill || !progressPercentage || !quotaSection) {
        logger.warn("Quota display elements not found")
        return
    }

    // Render from cache immediately
    const cached = await loadCachedQuota()
    if (cached) {
        renderQuota(cached.used, cached.limit)
    }

    // Fetch fresh data from background
    fetchQuotaUsage()
}

/**
 * Send QUOTA_USAGE_REQUEST to background and update UI with response.
 */
function fetchQuotaUsage(): void {
    const message: QuotaUsageRequestMessage = { type: "QUOTA_USAGE_REQUEST" }

    chrome.runtime.sendMessage(message, (response: QuotaUsageResponseMessage) => {
        if (chrome.runtime.lastError) {
            logger.error("Failed to fetch quota usage:", chrome.runtime.lastError.message)
            showError()
            return
        }

        if (!response || !response.success || !response.data) {
            logger.warn("Quota usage response invalid:", response?.error ?? "no data")
            showError()
            return
        }

        const quota = response.data.fullTextTranslation
        const isOfficialProvider = response.data.isOfficialProvider
        renderQuota(quota.used, quota.limit, isOfficialProvider)
        saveCachedQuota(quota)
        logger.debug(`Quota loaded: ${quota.used}/${quota.limit}, officialProvider: ${isOfficialProvider}`)
    })
}

/**
 * Render quota progress bar and percentage text.
 */
function renderQuota(used: number, limit: number, isOfficialProvider: boolean = true): void {
    if (!progressBarFill || !progressPercentage || !quotaSection) return

    // Hide quota section for non-official providers (quota only applies to official)
    if (!isOfficialProvider) {
        quotaSection.style.display = "none"
        disableTranslateButton(false)
        return
    }
    quotaSection.style.display = ""
    const percentage = limit > 0 ? Math.min(Math.round((used / limit) * 100), 100) : 0

    // Update progress bar width
    progressBarFill.style.width = `${percentage}%`

    // Update percentage text
    progressPercentage.textContent = `${used} / ${limit}`

    // Remove loading state
    quotaSection.classList.remove("is-loading")

    // Apply color state
    quotaSection.classList.remove("quota-normal", "quota-warning", "quota-exhausted")
    if (percentage >= PERCENTAGE_EXHAUSTED_THRESHOLD) {
        quotaSection.classList.add("quota-exhausted")
        disableTranslateButton(true)
    } else if (percentage >= PERCENTAGE_WARNING_THRESHOLD) {
        quotaSection.classList.add("quota-warning")
        disableTranslateButton(false)
    } else {
        quotaSection.classList.add("quota-normal")
        disableTranslateButton(false)
    }
}

/**
 * Show error state in quota display.
 */
function showError(): void {
    if (!progressPercentage || !quotaSection) return

    quotaSection.classList.remove("is-loading")
    progressPercentage.textContent = i18nModule.translate("popup.quota.error")
}

/**
 * Disable/enable the full-translate button when quota is exhausted.
 */
function disableTranslateButton(disabled: boolean): void {
    if (!fullTranslateButton) return

    if (disabled) {
        fullTranslateButton.disabled = true
        fullTranslateButton.classList.add("is-quota-exhausted")
        fullTranslateButton.title = i18nModule.translate("popup.quota.exhausted")
    } else {
        fullTranslateButton.disabled = false
        fullTranslateButton.classList.remove("is-quota-exhausted")
        fullTranslateButton.title = ""
    }
}

/**
 * Load cached quota data from chrome.storage.local.
 */
async function loadCachedQuota(): Promise<QuotaDisplayCache | null> {
    try {
        const result = await chrome.storage.local.get(QUOTA_CACHE_KEY)
        return result[QUOTA_CACHE_KEY] ?? null
    } catch {
        return null
    }
}

/**
 * Update quota section visibility based on the selected translation provider.
 */
export function updateForProvider(provider: string): void {
    if (!quotaSection) return

    if (provider === "official") {
        quotaSection.style.display = ""
        fetchQuotaUsage()
    } else {
        quotaSection.style.display = "none"
        disableTranslateButton(false)
    }
}

/**
 * Save quota data to chrome.storage.local for instant rendering on next popup open.
 */
function saveCachedQuota(quota: FullTextTranslationQuotaInfo): void {
    const cache: QuotaDisplayCache = {
        used: quota.used,
        limit: quota.limit,
        remaining: quota.remaining,
        timestamp: Date.now(),
    }
    chrome.storage.local.set({ [QUOTA_CACHE_KEY]: cache }).catch((error) => {
        logger.warn("Failed to cache quota data:", error)
    })
}
