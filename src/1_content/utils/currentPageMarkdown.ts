import { Readability } from "@mozilla/readability"
import TurndownService from "turndown"
import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("currentPageMarkdown")

const EMPTY_TEXT = ""
const MAX_MARKDOWN_LENGTH = 50_000
const MIN_READABILITY_TEXT_LENGTH = 200
const MIN_FALLBACK_TEXT_LENGTH = 120
const MAX_FALLBACK_BLOCKS = 400
const EXTENSION_SELECTOR = "[data-tapword-ext]"
const NOISE_SELECTOR = [
    "script",
    "style",
    "noscript",
    "template",
    "iframe",
    "canvas",
    "svg",
    "dialog",
    "button",
    "input",
    "select",
    "textarea",
    "nav",
    "aside",
    "footer",
    EXTENSION_SELECTOR,
    "[aria-hidden='true']",
    "[hidden]",
    "[role='dialog']",
    "[role='alert']",
    "[role='navigation']",
    "[role='complementary']",
    "[role='search']",
    "[data-testid*='nav']",
    "[data-testid*='footer']",
].join(", ")
const MAIN_CONTENT_SELECTOR = "main, article, [role='main'], .main, .content, #content"
const STRUCTURED_BLOCK_SELECTOR = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "blockquote",
    "pre",
    "code",
    "ul > li",
    "ol > li",
    "table",
].join(", ")

interface PageMarkdownResult {
    markdown: string
    mode: "readability" | "fallback"
}

interface PageMetadata {
    title: string
    url: string
    siteName: string
    byline: string
    excerpt: string
}

/** Build a structured high-signal Markdown snapshot for the current page. */
export function extractCurrentPageMarkdown(): string {
    const readabilityResult = tryExtractWithReadability()
    if (readabilityResult) {
        logger.info(`Current page extracted with ${readabilityResult.mode}: ${readabilityResult.markdown.length} chars`)
        return readabilityResult.markdown
    }

    const fallbackResult = extractWithSemanticFallback()
    logger.info(`Current page extracted with ${fallbackResult.mode}: ${fallbackResult.markdown.length} chars`)
    return fallbackResult.markdown
}

function tryExtractWithReadability(): PageMarkdownResult | null {
    try {
        const clonedDocument = cloneCurrentDocument()
        sanitizeDocument(clonedDocument)
        injectBaseUrl(clonedDocument, window.location.href)

        const article = new Readability(clonedDocument).parse()
        const markdownBody = htmlToMarkdown(article?.content ?? EMPTY_TEXT)
        if (!article || normalizeText(markdownBody).length < MIN_READABILITY_TEXT_LENGTH) {
            return null
        }

        const metadata: PageMetadata = {
            title: normalizeText(article.title) || document.title || "Untitled Page",
            url: window.location.href,
            siteName: normalizeText(article.siteName),
            byline: normalizeText(article.byline),
            excerpt: normalizeText(article.excerpt),
        }

        return {
            markdown: buildStructuredMarkdown(metadata, markdownBody),
            mode: "readability",
        }
    } catch (error) {
        logger.warn("Readability extraction failed:", error)
        return null
    }
}

function extractWithSemanticFallback(): PageMarkdownResult {
    const metadata: PageMetadata = {
        title: normalizeText(document.title) || "Untitled Page",
        url: window.location.href,
        siteName: normalizeText(window.location.hostname),
        byline: EMPTY_TEXT,
        excerpt: extractMetaDescription(),
    }
    const root = resolveContentRoot()
    const blocks = Array.from(root.querySelectorAll(STRUCTURED_BLOCK_SELECTOR))
    const markdownBlocks: string[] = []
    const seen = new Set<string>()

    for (const block of blocks) {
        if (markdownBlocks.length >= MAX_FALLBACK_BLOCKS) {
            break
        }
        if (!isMeaningfulBlock(block)) {
            continue
        }

        const blockMarkdown = convertElementToMarkdown(block)
        const normalizedBlock = normalizeText(blockMarkdown)
        if (normalizedBlock.length === 0 || seen.has(normalizedBlock)) {
            continue
        }

        seen.add(normalizedBlock)
        markdownBlocks.push(blockMarkdown)
    }

    const markdownBody = cleanupMarkdown(markdownBlocks.join("\n\n"))
    const body = normalizeText(markdownBody).length >= MIN_FALLBACK_TEXT_LENGTH
        ? markdownBody
        : normalizeText(root.innerText)

    return {
        markdown: buildStructuredMarkdown(metadata, body),
        mode: "fallback",
    }
}

function cloneCurrentDocument(): Document {
    return new DOMParser().parseFromString(document.documentElement.outerHTML, "text/html")
}

function sanitizeDocument(doc: Document): void {
    doc.querySelectorAll(NOISE_SELECTOR).forEach((element) => {
        element.remove()
    })
}

function injectBaseUrl(doc: Document, url: string): void {
    const baseElement = doc.createElement("base")
    baseElement.href = url
    doc.head.prepend(baseElement)
}

function resolveContentRoot(): HTMLElement {
    const root = document.querySelector(MAIN_CONTENT_SELECTOR)
    if (root instanceof HTMLElement) {
        return root
    }
    return document.body
}

function isMeaningfulBlock(element: Element): boolean {
    if (!(element instanceof HTMLElement)) {
        return false
    }
    if (element.closest(NOISE_SELECTOR)) {
        return false
    }
    if (element.matches(EXTENSION_SELECTOR)) {
        return false
    }
    if (!isVisiblyReadable(element)) {
        return false
    }
    const text = normalizeText(element.innerText || element.textContent || EMPTY_TEXT)
    return text.length > 0
}

function isVisiblyReadable(element: HTMLElement): boolean {
    const style = window.getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden") {
        return false
    }
    if (element.closest("[hidden], [aria-hidden='true']")) {
        return false
    }
    return true
}

function convertElementToMarkdown(element: Element): string {
    if (element.tagName === "TABLE") {
        return normalizeText((element as HTMLElement).innerText)
    }
    return htmlToMarkdown(element.outerHTML)
}

function htmlToMarkdown(html: string): string {
    const turndown = createTurndownService()
    return cleanupMarkdown(turndown.turndown(html))
}

function createTurndownService(): TurndownService {
    const turndown = new TurndownService({
        headingStyle: "atx",
        codeBlockStyle: "fenced",
        bulletListMarker: "-",
    })

    turndown.remove([
        "img",
        "picture",
        "video",
        "audio",
        "source",
        "canvas",
        "form",
        "button",
        "input",
        "select",
        "textarea",
        "style",
        "script",
        "noscript",
        "iframe",
    ])

    return turndown
}

function buildStructuredMarkdown(metadata: PageMetadata, body: string): string {
    const lines: string[] = [`# ${metadata.title}`]

    lines.push("")
    lines.push(`Source: ${metadata.url}`)
    if (metadata.siteName) {
        lines.push(`Site: ${metadata.siteName}`)
    }
    if (metadata.byline) {
        lines.push(`Author: ${metadata.byline}`)
    }
    if (metadata.excerpt) {
        lines.push("")
        lines.push(`> ${metadata.excerpt}`)
    }
    lines.push("")
    lines.push("## Content")
    lines.push("")
    lines.push(cleanupMarkdown(body) || "No readable content found.")

    return truncateMarkdown(lines.join("\n"))
}

function extractMetaDescription(): string {
    const descriptionElement = document.querySelector("meta[name='description'], meta[property='og:description']")
    if (!(descriptionElement instanceof HTMLMetaElement)) {
        return EMPTY_TEXT
    }
    return normalizeText(descriptionElement.content)
}

function truncateMarkdown(markdown: string): string {
    if (markdown.length <= MAX_MARKDOWN_LENGTH) {
        return markdown
    }
    const truncated = markdown.slice(0, MAX_MARKDOWN_LENGTH)
    return `${truncated}\n\n[Content truncated to ${MAX_MARKDOWN_LENGTH} characters.]`
}

function cleanupMarkdown(markdown: string): string {
    return markdown
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+\n/g, "\n")
        .trim()
}

function normalizeText(value: string | null | undefined): string {
    return (value ?? EMPTY_TEXT).replace(/\s+/g, " ").trim()
}
