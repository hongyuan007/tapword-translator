/**
 * Prompt loader utility
 *
 * Loads prompt templates and few-shot examples from resources directory
 * Supports caching and language-specific fallback
 */

import * as loggerModule from "@/0_common/utils/logger"
import type { ChatMessage } from "../types/GenerateTypes"
import * as constants from "../constants/GenerateConstants"

const logger = loggerModule.createLogger("8_generate/promptLoader")

// Cache for loaded prompts
const systemCache = new Map<string, string>()
const templateCache = new Map<string, string>()
const fewshotCache = new Map<string, ChatMessage[]>()

/**
 * Get prompt resource path
 * Browser extension uses chrome.runtime.getURL() to access resources
 * @param taskName Task name (e.g., 'word_translation')
 * @param fileName File name (e.g., 'system_prompt.txt')
 * @returns Resource URL
 */
function getResourceUrl(taskName: string, fileName: string): string {
    const path = `resources/8_generate/${taskName}/${fileName}`
    return chrome.runtime.getURL(path)
}

/**
 * Fetch text file from resources
 * @param taskName Task name
 * @param fileName File name
 * @returns File content as string
 */
async function fetchTextFile(taskName: string, fileName: string): Promise<string> {
    const url = getResourceUrl(taskName, fileName)

    logger.debug(`Fetching text file from: ${url}`)

    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
        }
        return await response.text()
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined
        logger.error(`Failed to load prompt file: ${url}`, errorMsg, errorStack)
        throw new Error(`Missing or invalid prompt file: ${fileName} at ${url} - ${errorMsg}`)
    }
}

/**
 * Load system prompt for a task
 * @param taskName Task name (e.g., 'word_translation')
 * @returns System prompt text
 */
export async function loadSystemPrompt(taskName: string): Promise<string> {
    const cacheKey = taskName
    if (systemCache.has(cacheKey)) {
        return systemCache.get(cacheKey)!
    }

    const content = await fetchTextFile(taskName, constants.PROMPT_FILE_SYSTEM)
    systemCache.set(cacheKey, content)
    return content
}

/**
 * Load user prompt template for a task
 * @param taskName Task name (e.g., 'word_translation')
 * @returns User prompt template text
 */
export async function loadUserPromptTemplate(taskName: string): Promise<string> {
    const cacheKey = taskName
    if (templateCache.has(cacheKey)) {
        return templateCache.get(cacheKey)!
    }

    const content = await fetchTextFile(taskName, constants.PROMPT_FILE_USER_TEMPLATE)
    templateCache.set(cacheKey, content)
    return content
}

/**
 * Load few-shot examples for a task
 * Supports language-specific examples with fallback to English
 *
 * @param taskName Task name (e.g., 'word_translation')
 * @param language Target language code (e.g., 'zh', 'ja', 'en')
 * @returns Array of chat messages for few-shot examples
 */
export async function loadFewshot(
    taskName: string,
    language?: string,
    fileName: string = constants.PROMPT_FILE_FEWSHOT
): Promise<ChatMessage[]> {
    // Normalize language code (remove region variants like zh-CN -> zh)
    const normalizedLang = (language?.split("-")[0] || constants.DEFAULT_FEWSHOT_LANGUAGE).toLowerCase()
    const cacheKey = `${taskName}:${normalizedLang}:${fileName}`

    if (fewshotCache.has(cacheKey)) {
        return fewshotCache.get(cacheKey)!
    }

    // Try language-specific fewshot first, then fall back to English
    const candidateUrl = getResourceUrl(taskName, `${normalizedLang}/${fileName}`)
    const fallbackUrl = getResourceUrl(taskName, `${constants.DEFAULT_FEWSHOT_LANGUAGE}/${fileName}`)

    logger.debug(`Attempting to load fewshot from: ${candidateUrl}`)

    let url = candidateUrl
    let response: Response | null = null

    // Try to fetch language-specific fewshot
    try {
        response = await fetch(url)
        if (!response.ok) {
            logger.debug(`Fewshot file not found for language '${normalizedLang}' (status: ${response.status}), will try fallback`)
            response = null
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        logger.debug(`Failed to fetch fewshot from ${url}: ${errorMsg}, will try fallback`)
        response = null
    }

    // Fallback to English if language-specific file not found or failed
    if (!response) {
        url = fallbackUrl
        logger.debug(`Attempting to load fallback fewshot from: ${url}`)

        try {
            response = await fetch(url)
            if (!response.ok) {
                logger.warn(`Fallback fewshot also not found (status: ${response.status})`)
                response = null
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            const errorStack = error instanceof Error ? error.stack : undefined
            logger.error(`Failed to fetch fallback fewshot from ${url}`, errorMsg, errorStack)
            throw new Error(`Failed to fetch fallback fewshot file: ${url} - ${errorMsg}`)
        }
    }

    if (!response) {
        logger.warn(`No fewshot examples found for task '${taskName}'`)
        fewshotCache.set(cacheKey, [])
        return []
    }

    try {
        const rawText = await response.text()
        const parsed = JSON.parse(rawText) as ChatMessage[]
        logger.debug(`Loaded fewshot examples from ${url} (count: ${parsed.length})`)
        fewshotCache.set(cacheKey, parsed)
        return parsed
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        const errorStack = error instanceof Error ? error.stack : undefined
        logger.error(`Failed to parse fewshot JSON from ${url} — error: ${errorMsg}`, errorStack)
        throw new Error(`Invalid fewshot JSON file: ${url} — ${errorMsg}`)
    }
}
