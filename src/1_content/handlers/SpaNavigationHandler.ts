/**
 * SPA Navigation Handler
 *
 * Detects real page navigations in Single Page Applications (e.g. YouTube)
 * and clears all injected translation UI to prevent stale DOM fragments from
 * leaking into the next page's content.
 *
 * Detection strategy:
 * - MutationObserver on <head> catches title/meta updates triggered by the SPA router.
 * - popstate handles browser Back/Forward navigation.
 * - Only fires when the "core URL" (origin + pathname + search) changes.
 *   Pure hash (#anchor) changes are intentionally ignored to avoid clearing
 *   translations on in-page anchor scrolls.
 */

import * as loggerModule from "@/0_common/utils/logger"
import * as iconManager from "@/1_content/ui/iconManager"
import * as translationDisplay from "@/1_content/ui/translationDisplayV2"

const logger = loggerModule.createLogger("1_content/handlers/SpaNavigationHandler")

let lastNavigationUrl = getCoreUrl(window.location.href)

function getCoreUrl(rawUrl: string): string {
    try {
        const parsed = new URL(rawUrl, window.location.origin)
        return `${parsed.origin}${parsed.pathname}${parsed.search}`
    } catch {
        return rawUrl.split("#")[0] || ""
    }
}

function onNavigation(trigger: string): void {
    const currentUrl = getCoreUrl(window.location.href)
    if (currentUrl === lastNavigationUrl) {
        return
    }

    lastNavigationUrl = currentUrl
    translationDisplay.removeAllTranslationResults()
    iconManager.removeTranslationIcon()
    window.getSelection()?.removeAllRanges()

    logger.info("Cleared translation UI after navigation", { trigger, currentUrl })
}

/**
 * Register all SPA navigation listeners.
 * Should be called once during content script initialization.
 */
export function setup(): void {
    const observer = new MutationObserver(() => onNavigation("head-mutation"))

    if (document.head) {
        observer.observe(document.head, {
            childList: true,
            subtree: true,
            characterData: true,
        })
    }

    window.addEventListener("popstate", () => onNavigation("popstate"))
}
