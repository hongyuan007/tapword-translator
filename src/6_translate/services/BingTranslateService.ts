/**
 * Bing Translate Service
 *
 * Provides translation using Bing Translate API (free, no key required)
 * Implementation based on https://github.com/plainheart/bing-translate-api
 * Uses native fetch for browser extension compatibility
 */

import { createLogger } from "@/0_common/utils/logger"
import type { BingTranslateSettings } from "@/0_common/types"

const logger = createLogger("BingTranslateService")

const BING_TRANSLATE_TIMEOUT = 10000 // 10 seconds timeout

// Try different Bing subdomains based on region
const BING_SUBDOMAINS = ["cn.bing.com", "www.bing.com", "bing.com"]
let currentSubdomain: string | null = null

/**
 * Bing Translate language code mapping
 */
const LANGUAGE_CODE_MAP: Record<string, string> = {
    zh: "zh-Hans",
    "zh-Hant": "zh-Hant",
    en: "en",
    ja: "ja",
    ko: "ko",
    fr: "fr",
    es: "es",
    de: "de",
    ru: "ru",
    it: "it",
    pt: "pt",
    nl: "nl",
    pl: "pl",
    vi: "vi",
    tr: "tr",
    hi: "hi",
    th: "th",
    id: "id",
    ms: "ms",
    ar: "ar",
    he: "he",
    fa: "fa",
    uk: "uk",
    bg: "bg",
    cs: "cs",
    sk: "sk",
    ro: "ro",
    hu: "hu",
    hr: "hr",
    sr: "sr",
    sl: "sl",
    et: "et",
    lv: "lv",
    lt: "lt",
    fi: "fi",
    sv: "sv",
    da: "da",
    nb: "nb",
    nn: "nn",
    el: "el",
    ca: "ca",
}

/**
 * Map extension language code to Bing Translate language code
 */
function mapToBingLanguage(langCode: string): string {
    return LANGUAGE_CODE_MAP[langCode] || langCode
}

/**
 * Error thrown when Bing Translate request fails
 */
export class BingTranslateError extends Error {
    constructor(
        message: string,
        public statusCode?: number,
        public responseBody?: string
    ) {
        super(message)
        this.name = "BingTranslateError"
    }
}

/**
 * Global config cache for Bing Translate
 */
interface BingGlobalConfig {
    IG: string
    IID: string
    key: string
    token: string
    tokenExpiryInterval: number
    tokenTs: number
    count: number
}

let globalConfig: BingGlobalConfig | null = null

/**
 * Fetch global config from Bing Translator page
 */
async function fetchGlobalConfig(): Promise<BingGlobalConfig> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BING_TRANSLATE_TIMEOUT)

    // If we don't have a cached subdomain, try to find one that works
    const subdomainsToTry = currentSubdomain ? [currentSubdomain, ...BING_SUBDOMAINS.filter(d => d !== currentSubdomain)] : BING_SUBDOMAINS
    
    let lastError: Error | null = null

    for (const subdomain of subdomainsToTry) {
        try {
            logger.info("Trying Bing subdomain:", subdomain)
            
            const response = await fetch(`https://${subdomain}/translator`, {
                method: "GET",
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                },
                signal: controller.signal,
            })

            if (!response.ok) {
                logger.warn(`Subdomain ${subdomain} returned status ${response.status}`)
                continue
            }

            const body = await response.text()

            // Extract IG
            const igMatch = body.match(/IG:"([^"]+)"/)
            if (!igMatch) {
                logger.warn(`Failed to extract IG from ${subdomain}`)
                continue
            }
            const IG = igMatch[1]

            // Extract IID
            const iidMatch = body.match(/data-iid="([^"]+)"/)
            if (!iidMatch) {
                logger.warn(`Failed to extract IID from ${subdomain}`)
                continue
            }
            const IID = iidMatch[1]

            // Extract key and token from params_AbusePreventionHelper
            const paramsMatch = body.match(/params_AbusePreventionHelper\s?=\s?(\[[^\]]+\])/)
            if (!paramsMatch) {
                logger.warn(`Failed to extract AbusePreventionHelper params from ${subdomain}`)
                continue
            }

            const params = JSON.parse(paramsMatch[1])
            const key = params[0]
            const token = params[1]
            const tokenExpiryInterval = params[2]

            // Cache the working subdomain
            currentSubdomain = subdomain

            globalConfig = {
                IG,
                IID,
                key,
                token,
                tokenExpiryInterval,
                tokenTs: Date.now(),
                count: 0,
            }

            logger.info("Fetched Bing global config from", subdomain, ":", { IG, IID, tokenExpiryInterval })
            return globalConfig
        } catch (error) {
            logger.warn(`Failed to fetch config from ${subdomain}:`, error instanceof Error ? error.message : String(error))
            lastError = error instanceof Error ? error : new Error(String(error))
        }
    }

    clearTimeout(timeoutId)
    throw new BingTranslateError(`Failed to fetch Bing config from all subdomains: ${lastError?.message || "Unknown error"}`)
}

/**
 * Check if config needs refresh (token expired)
 */
function isConfigExpired(): boolean {
    if (!globalConfig) return true
    return Date.now() - globalConfig.tokenTs > globalConfig.tokenExpiryInterval
}

/**
 * Get valid config (refresh if needed)
 */
async function getValidConfig(): Promise<BingGlobalConfig> {
    if (isConfigExpired()) {
        await fetchGlobalConfig()
    }
    if (!globalConfig) {
        throw new BingTranslateError("Global config not available")
    }
    return globalConfig
}

/**
 * Translate text using Bing Translate API
 * @param text Text to translate
 * @param targetLanguage Target language code
 * @param _settings Bing Translate settings (not used)
 * @returns Translated text
 */
export async function translateWithBingTranslate(
    text: string,
    targetLanguage: string,
    _settings: BingTranslateSettings
): Promise<string> {
    const toLang = mapToBingLanguage(targetLanguage)
    const fromLang = "auto-detect"

    logger.info("Sending Bing Translate request:", { text, fromLang, toLang })

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BING_TRANSLATE_TIMEOUT)

    try {
        const config = await getValidConfig()
        config.count++

        // Use the cached working subdomain
        const subdomain = currentSubdomain || BING_SUBDOMAINS[0]
        const url = `https://${subdomain}/ttranslatev3?IG=${config.IG}&IID=${config.IID}&SFX=${config.count}&ref=TThis&edgepdftranslator=1`

        const formData = new URLSearchParams()
        formData.append("fromLang", fromLang)
        formData.append("to", toLang)
        formData.append("text", text)
        formData.append("token", config.token)
        formData.append("key", config.key)
        formData.append("tryFetchingGenderDebiasedTranslations", "true")

        logger.debug("Bing Translate URL:", url)
        logger.debug("Bing Translate body:", Object.fromEntries(formData))

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json, text/plain, */*",
                "Origin": `https://${subdomain}`,
                "Referer": `https://${subdomain}/translator`,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "Sec-Fetch-Dest": "empty",
                "Sec-Fetch-Mode": "cors",
                "Sec-Fetch-Site": "same-origin",
            },
            body: formData.toString(),
            signal: controller.signal,
        })

        logger.debug("Bing Translate response status:", response.status, response.statusText)

        const responseText = await response.text()
        
        // Log raw response for debugging
        logger.debug("Bing raw response:", responseText.substring(0, 1000))

        if (!response.ok) {
            throw new BingTranslateError(
                `Bing Translate responded with status ${response.status}: ${responseText.substring(0, 200)}`,
                response.status,
                responseText
            )
        }

        // Parse JSON
        let data: unknown
        try {
            data = JSON.parse(responseText)
        } catch (parseError) {
            logger.error("Failed to parse Bing response as JSON:", responseText)
            throw new BingTranslateError(
                `Failed to parse Bing response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                response.status,
                responseText
            )
        }

        // Parse Bing's response format
        // Response: [{translations: [{text: "...", to: "..."}]}, {detectedLanguage: {...}}]
        if (!Array.isArray(data) || !data[0]?.translations?.[0]?.text) {
            logger.error("Invalid Bing Translate response structure:", data)
            throw new BingTranslateError("Bing Translate returned invalid response format")
        }

        const translation = data[0].translations[0].text
        logger.info("Bing Translate result:", translation)
        return translation
    } catch (error) {
        if (error instanceof BingTranslateError) {
            throw error
        }
        if (error instanceof Error && error.name === "AbortError") {
            logger.error("Bing Translate translation timeout")
            throw new BingTranslateError(`Failed to translate: Connection timeout after ${BING_TRANSLATE_TIMEOUT / 1000}s`)
        }
        logger.error("Bing Translate translation error:", error)
        throw new BingTranslateError(`Failed to translate: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
        clearTimeout(timeoutId)
    }
}

/**
 * Test Bing Translate connection
 */
export async function testBingTranslateConnection(_settings: BingTranslateSettings): Promise<boolean> {
    try {
        // Reset config to force refresh
        globalConfig = null
        const result = await translateWithBingTranslate("hello", "en", {})
        logger.info("Bing Translate connection test successful:", result)
        return true
    } catch (error) {
        if (error instanceof BingTranslateError) {
            throw error
        }
        logger.error("Bing Translate connection test failed:", error)
        throw new BingTranslateError(`Failed to connect to Bing Translate: ${error instanceof Error ? error.message : String(error)}`)
    }
}
