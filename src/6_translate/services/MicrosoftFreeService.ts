/**
 * Microsoft Free Translation Service
 *
 * Provides translation using Microsoft Edge free API (no key required).
 * Uses token caching to minimize auth requests.
 */

import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("MicrosoftFreeService")

const MS_AUTH_URL = "https://edge.microsoft.com/translate/auth"
const MS_TRANSLATE_URL = "https://api-edge.cognitive.microsofttranslator.com/translate"
const TOKEN_TTL_MS = 9 * 60 * 1000 // 9 minutes (tokens valid ~10 min)
const REQUEST_TIMEOUT_MS = 10000

/** Language code mapping for Microsoft Translate */
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
    ar: "ar",
    hi: "hi",
    th: "th",
    vi: "vi",
    tr: "tr",
    nl: "nl",
    pl: "pl",
    uk: "uk",
    sv: "sv",
    da: "da",
    fi: "fi",
    nb: "nb",
    id: "id",
    ms: "ms",
    cs: "cs",
    sk: "sk",
    ro: "ro",
    hu: "hu",
    bg: "bg",
    hr: "hr",
    sr: "sr",
    he: "he",
    fa: "fa",
}

const MS_TOKEN_CACHE_KEY = "msTranslateTokenCache"

interface MsTokenCache {
    token: string
    expiresAt: number
}

async function fetchToken(): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
        const response = await fetch(MS_AUTH_URL, {
            method: "GET",
            signal: controller.signal,
        })
        if (!response.ok) {
            throw new Error(`Failed to fetch Microsoft token: ${response.status}`)
        }
        const token = await response.text()
        return token.trim()
    } finally {
        clearTimeout(timer)
    }
}

async function getToken(): Promise<string> {
    const stored = await chrome.storage.local.get(MS_TOKEN_CACHE_KEY)
    const cached = stored[MS_TOKEN_CACHE_KEY] as MsTokenCache | undefined
    if (cached && Date.now() < cached.expiresAt) {
        return cached.token
    }
    logger.info("Fetching new Microsoft Translate token")
    const token = await fetchToken()
    await chrome.storage.local.set({ [MS_TOKEN_CACHE_KEY]: { token, expiresAt: Date.now() + TOKEN_TTL_MS } })
    return token
}

function mapLanguageCode(lang: string): string {
    return LANGUAGE_CODE_MAP[lang] ?? lang
}

/**
 * Translate text using Microsoft free translation API.
 * @param text - Text to translate
 * @param targetLang - Target language code (e.g., "zh", "en")
 */
export async function translateWithMicrosoftFree(text: string, targetLang: string): Promise<string> {
    const token = await getToken()
    const mappedLang = mapLanguageCode(targetLang)

    const url = `${MS_TRANSLATE_URL}?api-version=3.0&to=${encodeURIComponent(mappedLang)}&textType=html`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Ocp-Apim-Subscription-Key": token,
                "Content-Type": "application/json",
            },
            body: JSON.stringify([{ Text: text }]),
            signal: controller.signal,
        })

        if (!response.ok) {
            // If 401, attempt token refresh once
            if (response.status === 401) {
                logger.warn("Microsoft token expired, refreshing...")
                await chrome.storage.local.remove(MS_TOKEN_CACHE_KEY)
                return translateWithMicrosoftFree(text, targetLang)
            }
            throw new Error(`Microsoft Translate API error: ${response.status}`)
        }

        const data = (await response.json()) as Array<{ translations: Array<{ text: string }> }>
        const result = data[0]?.translations?.[0]?.text
        if (!result) {
            throw new Error("Microsoft Translate returned empty result")
        }
        return result
    } finally {
        clearTimeout(timer)
    }
}

/** Error class for Microsoft Free translation errors */
export class MicrosoftFreeError extends Error {
    constructor(message: string) {
        super(message)
        this.name = "MicrosoftFreeError"
    }
}
