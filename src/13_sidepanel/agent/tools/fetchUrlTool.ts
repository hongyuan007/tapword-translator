import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"
import * as loggerModule from "@/0_common/utils/logger"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("fetchUrlTool")

const DEFAULT_MAX_LENGTH = 20_000
const DEFAULT_START_INDEX = 0

interface FetchUrlResponse {
    success: boolean
    content?: string
    contentType?: string
    statusCode?: number
    error?: string
}

/** Detect whether content is HTML based on content-type header and content heuristics. */
function isHtmlContent(contentType: string, content: string): boolean {
    if (contentType.includes("text/html")) return true
    const prefix = content.slice(0, 200).trimStart().toLowerCase()
    return prefix.startsWith("<!doctype") || prefix.startsWith("<html")
}

/** Extract main article content from HTML using Readability, fallback to full HTML. */
function extractMainContent(html: string, url: string): string {
    try {
        const doc = new DOMParser().parseFromString(html, "text/html")
        // Set the documentURI for Readability to resolve relative URLs
        const baseEl = doc.createElement("base")
        baseEl.href = url
        doc.head.appendChild(baseEl)

        const article = new Readability(doc).parse()
        if (article?.content) {
            return article.content
        }
        logger.warn("Readability returned null, falling back to full HTML")
    } catch (err) {
        logger.warn("Readability extraction failed, falling back to full HTML:", err)
    }
    return html
}

/** Convert HTML to clean markdown. */
function htmlToMarkdown(html: string): string {
    const turndown = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
    })
    return turndown.turndown(html)
}

// ─── fetch_url ─────────────────────────────────────────────────

export const fetchUrlTool: ToolRegistration = {
    definition: {
        name: "fetch_url",
        description:
            "Fetch a URL from the internet and return its contents as markdown text. " +
            "Useful for reading documentation, articles, or any web page. " +
            "HTML pages are automatically converted to clean markdown for readability. " +
            "Non-HTML content (JSON, plain text, etc.) is returned as-is.",
        input_schema: {
            type: "object" as const,
            properties: {
                url: {
                    type: "string",
                    description: "The URL to fetch (must start with http:// or https://)",
                },
                max_length: {
                    type: "number",
                    description:
                        "Maximum number of characters to return (default: 20000). " +
                        "Use a smaller value to save context window space.",
                },
                start_index: {
                    type: "number",
                    description:
                        "Start returning content from this character index (default: 0). " +
                        "Use this to paginate through long pages when a previous fetch was truncated.",
                },
                extract_main_content: {
                    type: "boolean",
                    description:
                        "If true (default), extract only the main article content, " +
                        "removing navigation, sidebars, footers, etc. Set to false for raw full-page content.",
                },
            },
            required: ["url"],
        },
    },
    label: "Fetching URL...",
    descriptionCN: "获取指定 URL 的网页内容",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const url = input.url as string
        const maxLength = (input.max_length as number) ?? DEFAULT_MAX_LENGTH
        const startIndex = (input.start_index as number) ?? DEFAULT_START_INDEX
        const extractMain = (input.extract_main_content as boolean) ?? true

        // Validate URL
        if (!url || (!url.startsWith("http://") && !url.startsWith("https://"))) {
            return "Error: Invalid URL. Must start with http:// or https://"
        }

        try {
            // Send fetch request to background service worker
            const response = await chrome.runtime.sendMessage({
                type: "FETCH_URL",
                url,
            }) as FetchUrlResponse

            if (!response) {
                return "Error: Failed to communicate with background service."
            }

            if (!response.success) {
                return `Error: ${response.error ?? "Unknown fetch error"}`
            }

            const rawContent = response.content ?? ""
            const contentType = response.contentType ?? ""

            if (!rawContent) {
                return `The page at ${url} returned no extractable content.`
            }

            let processedContent: string
            const html = isHtmlContent(contentType, rawContent)

            if (html) {
                // HTML pipeline: extract main content → convert to markdown
                const htmlContent = extractMain
                    ? extractMainContent(rawContent, url)
                    : rawContent
                processedContent = htmlToMarkdown(htmlContent)
            } else {
                // Non-HTML: return raw content with content-type prefix
                processedContent = contentType
                    ? `Content-Type: ${contentType}\n\n${rawContent}`
                    : rawContent
            }

            // Apply start_index and max_length truncation
            const sliced = processedContent.slice(startIndex, startIndex + maxLength)
            const isTruncated = startIndex + maxLength < processedContent.length

            const header = html
                ? `Contents of ${url}:`
                : `Contents of ${url}${contentType ? ` (Content-Type: ${contentType})` : ""}:`

            let result = `${header}\n\n${sliced}`

            if (isTruncated) {
                const nextIndex = startIndex + maxLength
                result += `\n\n[Content truncated at ${maxLength} characters. Call fetch_url with start_index=${nextIndex} to continue reading.]`
            }

            logger.info(`Fetched ${url}: ${processedContent.length} chars total, returned ${sliced.length} chars`)
            return result
        } catch (err) {
            logger.error(`Failed to fetch ${url}:`, err)
            return `Error: ${err instanceof Error ? err.message : String(err)}`
        }
    },
}

// Self-register with the global tool registry
import { toolRegistry } from "./ToolRegistry"
toolRegistry.add(fetchUrlTool)
