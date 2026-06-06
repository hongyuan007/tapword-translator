/**
 * Bing Translate Service
 *
 * Provides translation using Bing Translate API (free, no key required)
 * Implementation based on https://github.com/plainheart/bing-translate-api
 * Uses native fetch for browser extension compatibility
 */

import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("BingTranslateService")

const BING_TRANSLATE_TIMEOUT = 10000 // 10 seconds timeout
const LOG_BODY_PREVIEW_LENGTH = 160
const DEFAULT_BING_SUBDOMAIN = "www.bing.com"

let currentSubdomain: string | null = null

/**
 * Returns ordered list of Bing subdomains based on user network region.
 * "global" → prefer international domain first; otherwise prefer CN domain.
 */
function getSubdomainsForRegion(networkRegion: string): string[] {
    if (networkRegion === "global") {
        return ["www.bing.com", "cn.bing.com", "bing.com"]
    }
    // "auto" or "china" — prefer CN domain
    return ["cn.bing.com", "www.bing.com", "bing.com"]
}

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

function sanitizeLogText(value: string): string {
    return value
        .replace(/params_AbusePreventionHelper\s?=\s?\[[^\]]+\]/g, "params_AbusePreventionHelper=[REDACTED]")
        .replace(/IG:"[^"]+"/g, 'IG:"[REDACTED]"')
        .replace(/data-iid="[^"]+"/g, 'data-iid="[REDACTED]"')
        .replace(/([?&](?:token|key|IG|IID|SFX)=)([^&\s]+)/g, "$1[REDACTED]")
}

function createBodyPreview(body: string): string {
    const normalized = sanitizeLogText(body).replace(/\s+/g, " ").trim()
    if (normalized.length <= LOG_BODY_PREVIEW_LENGTH) {
        return normalized
    }
    return `${normalized.slice(0, LOG_BODY_PREVIEW_LENGTH)}...`
}

function getResponseLocation(response: Response): { finalHost: string | null; finalPath: string | null } {
    try {
        const finalUrl = new URL(response.url)
        return {
            finalHost: finalUrl.hostname,
            finalPath: finalUrl.pathname,
        }
    } catch {
        return {
            finalHost: null,
            finalPath: null,
        }
    }
}

function buildResponseSummary(response: Response, body: string): Record<string, string | number | boolean | null> {
    const location = getResponseLocation(response)
    return {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type") || "unknown",
        redirected: response.redirected,
        finalHost: location.finalHost,
        finalPath: location.finalPath,
        responseSize: body.length,
        bodyPreview: createBodyPreview(body),
    }
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
let fetchConfigPromise: Promise<BingGlobalConfig> | null = null

/**
 * Fetch global config from Bing Translator page
 */
async function fetchGlobalConfig(networkRegion: string): Promise<BingGlobalConfig> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BING_TRANSLATE_TIMEOUT)

    // If we don't have a cached subdomain, try to find one that works
    const regionSubdomains = getSubdomainsForRegion(networkRegion)
    const subdomainsToTry = currentSubdomain ? [currentSubdomain, ...regionSubdomains.filter(d => d !== currentSubdomain)] : regionSubdomains
    
    let lastError: Error | null = null

    for (const [index, subdomain] of subdomainsToTry.entries()) {
        const attemptStartedAt = Date.now()
        try {
            logger.debug("Bing config fetch start:", {
                phase: "config-fetch",
                networkRegion,
                subdomain,
                attempt: index + 1,
            })
            
            const response = await fetch(`https://${subdomain}/translator`, {
                method: "GET",
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                },
                signal: controller.signal,
            })

            const body = await response.text()
            const responseSummary = buildResponseSummary(response, body)
            const logContext = {
                phase: "config-fetch",
                networkRegion,
                subdomain,
                attempt: index + 1,
                durationMs: Date.now() - attemptStartedAt,
                ...responseSummary,
            }

            if (!response.ok) {
                logger.warn("Bing config fetch returned non-OK response:", logContext)
                continue
            }

            if (!body) {
                logger.warn("Bing config fetch returned empty body:", logContext)
                continue
            }

            // Extract IG
            const igMatch = body.match(/IG:"([^"]+)"/)
            if (!igMatch) {
                logger.warn("Bing config fetch missing IG:", logContext)
                continue
            }
            const IG = igMatch[1]!

            // Extract IID
            const iidMatch = body.match(/data-iid="([^"]+)"/)
            if (!iidMatch) {
                logger.warn("Bing config fetch missing IID:", logContext)
                continue
            }
            const IID = iidMatch[1]!

            // Extract key and token from params_AbusePreventionHelper
            const paramsMatch = body.match(/params_AbusePreventionHelper\s?=\s?(\[[^\]]+\])/)
            if (!paramsMatch) {
                logger.warn("Bing config fetch missing AbusePreventionHelper params:", logContext)
                continue
            }

            const params = JSON.parse(paramsMatch[1]!)
            const key = params[0]
            const token = params[1]
            const tokenExpiryInterval = params[2]

            // Use the FINAL URL after redirects to get the actual subdomain
            // e.g. cn.bing.com may redirect to www.bing.com under VPN/proxy
            const finalUrl = new URL(response.url)
            const actualSubdomain = finalUrl.hostname

            // Cache the actual subdomain (may differ from original if redirected)
            currentSubdomain = actualSubdomain

            globalConfig = {
                IG,
                IID,
                key,
                token,
                tokenExpiryInterval,
                tokenTs: Date.now(),
                count: 0,
            }

            logger.debug("Bing config fetch success:", {
                phase: "config-fetch",
                networkRegion,
                attemptedSubdomain: subdomain,
                actualSubdomain,
                attempt: index + 1,
                redirected: response.redirected,
                status: response.status,
                contentType: response.headers.get("content-type") || "unknown",
                responseSize: body.length,
                tokenExpiryInterval,
                durationMs: Date.now() - attemptStartedAt,
            })
            clearTimeout(timeoutId)
            return globalConfig!
        } catch (error) {
            logger.warn("Bing config fetch request failed:", {
                phase: "config-fetch",
                networkRegion,
                subdomain,
                attempt: index + 1,
                durationMs: Date.now() - attemptStartedAt,
                error: error instanceof Error ? error.message : String(error),
            })
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
 * Get valid config (refresh if needed).
 * Deduplicates concurrent config fetches so only one in-flight request runs at a time.
 */
async function getValidConfig(networkRegion: string): Promise<BingGlobalConfig> {
    if (!isConfigExpired()) {
        return globalConfig!
    }
    if (!fetchConfigPromise) {
        fetchConfigPromise = fetchGlobalConfig(networkRegion).finally(() => {
            fetchConfigPromise = null
        })
    }
    return await fetchConfigPromise
}

/**
 * Translate text using Bing Translate API
 * @param text Text to translate
 * @param targetLanguage Target language code
 * @param networkRegion User network region setting ("auto" | "china" | "global")
 * @returns Translated text
 */
export async function translateWithBingTranslate(
    text: string,
    targetLanguage: string,
    networkRegion: string = "auto"
): Promise<string> {
    const toLang = mapToBingLanguage(targetLanguage)
    const fromLang = "auto-detect"

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BING_TRANSLATE_TIMEOUT)
    const translationStartedAt = Date.now()
    let phase = "config-fetch"
    let requestContext: Record<string, string | number | boolean | null> = {
        fromLang,
        toLang,
        networkRegion,
        textLength: text.length,
        subdomain: null,
    }

    try {
        const config = await getValidConfig(networkRegion)
        config.count++

        // Use the cached working subdomain
        const subdomains = getSubdomainsForRegion(networkRegion)
        const subdomain = currentSubdomain || subdomains[0] || DEFAULT_BING_SUBDOMAIN
        const url = `https://${subdomain}/ttranslatev3?IG=${config.IG}&IID=${config.IID}&SFX=${config.count}`
        phase = "translate-post"
        requestContext = {
            phase,
            fromLang,
            toLang,
            networkRegion,
            textLength: text.length,
            subdomain,
            requestSequence: config.count,
        }

        const formData = new URLSearchParams()
        formData.append("fromLang", fromLang)
        formData.append("to", toLang)
        formData.append("text", text)
        formData.append("token", config.token)
        formData.append("key", config.key)
        formData.append("tryFetchingGenderDebiasedTranslations", "true")

        logger.debug("Sending Bing Translate request:", requestContext)

        const response = await fetch(url, {
            method: "POST",
            credentials: "include",
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

        const responseText = await response.text()
        const responseSummary = buildResponseSummary(response, responseText)
        const responseContext = {
            ...requestContext,
            durationMs: Date.now() - translationStartedAt,
            ...responseSummary,
        }

        logger.debug("Bing Translate response summary:", responseContext)

        if (!responseText || responseText.trim() === "") {
            logger.warn("Bing Translate returned empty body:", responseContext)
        }

        if (!response.ok) {
            logger.warn("Bing Translate returned non-OK response:", responseContext)
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
            logger.error("Failed to parse Bing response as JSON:", responseContext)
            throw new BingTranslateError(
                `Failed to parse Bing response: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
                response.status,
                responseText
            )
        }

        // Parse Bing's response format
        // Response: [{translations: [{text: "...", to: "..."}]}, {detectedLanguage: {...}}]
        const firstResult = Array.isArray(data) ? data[0] : null
        const translations = typeof firstResult === "object" && firstResult !== null && "translations" in firstResult
            ? (firstResult as { translations?: Array<{ text?: unknown }> }).translations
            : undefined
        const translatedText = translations?.[0]?.text

        if (typeof translatedText !== "string" || translatedText.length === 0) {
            logger.error("Invalid Bing Translate response structure:", {
                ...responseContext,
                isArray: Array.isArray(data),
                hasTranslations: Array.isArray(translations) && translations.length > 0,
            })
            throw new BingTranslateError("Bing Translate returned invalid response format")
        }

        const translation = translatedText
        logger.info("Bing Translate result:", translation)
        return translation
    } catch (error) {
        if (error instanceof BingTranslateError) {
            throw error
        }
        if (error instanceof Error && error.name === "AbortError") {
            logger.error("Bing Translate translation timeout:", {
                ...requestContext,
                phase,
                durationMs: Date.now() - translationStartedAt,
            })
            throw new BingTranslateError(`Failed to translate: Connection timeout after ${BING_TRANSLATE_TIMEOUT / 1000}s`)
        }
        logger.error("Bing Translate translation error:", {
            ...requestContext,
            phase,
            durationMs: Date.now() - translationStartedAt,
            error: error instanceof Error ? error.message : String(error),
        })
        throw new BingTranslateError(`Failed to translate: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
        clearTimeout(timeoutId)
    }
}

/**
 * Test Bing Translate connection
 * @param networkRegion User network region setting
 */
export async function testBingTranslateConnection(networkRegion: string = "auto"): Promise<boolean> {
    try {
        // Reset config to force refresh
        globalConfig = null
        const result = await translateWithBingTranslate("hello", "zh", networkRegion)
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
