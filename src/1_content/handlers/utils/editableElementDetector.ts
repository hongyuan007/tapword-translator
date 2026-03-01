const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA"])
const EDITABLE_SELECTOR = `${Array.from(EDITABLE_TAGS)
    .map((tag) => tag.toLowerCase())
    .join(", ")}, [contenteditable]`
const CLICK_ATTRIBUTE = "onclick"
const TABINDEX_ATTRIBUTE = "tabindex"
const CURSOR_POINTER = "pointer"
const TEXT_CURSOR_ALLOWLIST = new Set(["text", "auto", "default"])
const STRONG_INTERACTIVE_TAG_SELECTOR =
    "a, button, select, label, video, audio, area, map, summary, iframe, embed, object"
const STRONG_INTERACTIVE_ROLE_SELECTOR =
    "[role='button'], [role='link'], [role='checkbox'], [role='radio'], [role='switch'], " +
    "[role='option'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], " +
    "[role='tab'], [role='treeitem'], [role='gridcell'], " +
    "[role='combobox'], [role='listbox'], [role='menu'], [role='menubar'], " +
    "[role='tablist'], [role='tree'], [role='treegrid'], [role='grid']"
const STRONG_INTERACTIVE_SELECTOR = `${STRONG_INTERACTIVE_TAG_SELECTOR}, ${STRONG_INTERACTIVE_ROLE_SELECTOR}`

import * as loggerModule from "@/0_common/utils/logger"
const logger = loggerModule.createLogger("editableElementDetector")

function isDirectlyEditable(element: Element): boolean {
    if (EDITABLE_TAGS.has(element.tagName)) {
        return true
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
        return true
    }

    return false
}

export function isEditableElement(element: Element | null): boolean {
    if (!element) {
        return false
    }

    if (isDirectlyEditable(element)) {
        return true
    }

    const closestEditable = element.closest(EDITABLE_SELECTOR)
    if (!closestEditable) {
        return false
    }

    return isDirectlyEditable(closestEditable)
}

function getElementFromTarget(target: EventTarget | null): HTMLElement | null {
    if (!target) {
        return null
    }

    if (target instanceof HTMLElement) {
        return target
    }

    if (target instanceof Text) {
        return target.parentElement
    }

    return null
}

export function isInteractiveElement(target: EventTarget | null, event?: Event): boolean {
    const element = getElementFromTarget(target)
    if (!element) {
        return false
    }

    if (isEditableElement(element)) {
        logger.debug("Editable element detected", {
            tag: element.tagName,
        })
        return true
    }

    if (event?.composedPath) {
        const path = event.composedPath()
        for (const node of path) {
            if (node instanceof HTMLElement) {
                const result = isInteractiveElementSelf(node, node === element)
                if (result.isInteractive) {
                    if (result.level === "weak" && isTextContentException(element)) {
                        logger.debug("Weak interactive element ignored (Text Exception)", {
                            elementTag: node.tagName,
                            elementReason: result.reason,
                            targetIsNode: node === element,
                        })
                        return false
                    }

                    logger.debug("Interactive element detected (path)", {
                        tag: node.tagName,
                        reason: result.reason,
                        level: result.level,
                        targetIsNode: node === element,
                        nodeClasses: node.className,
                    })
                    return true
                }
            }
        }
        return false
    }

    const result = isInteractiveElementByClosest(element)
    if (result.isInteractive) {
        if (result.level === "weak" && isTextContentException(element)) {
            logger.debug("Weak interactive element ignored (Text Exception - closest)", {
                elementTag: result.element?.tagName,
                elementReason: result.reason,
            })
            return false
        }

        logger.debug("Interactive element detected (closest)", {
            tag: result.element?.tagName,
            reason: result.reason,
            level: result.level,
        })
        return true
    }
    return false
}

/**
 * Check if the element looks like plain text content that should be translatable,
 * even if it's inside an interactive container.
 */
function isTextContentException(element: HTMLElement): boolean {
    // 1. Must check cursor style. 'text' or 'auto' or 'default' usually implies non-clickable text.
    // 'pointer' implies it's meant to be clicked.
    const style = window.getComputedStyle(element)
    
    if (TEXT_CURSOR_ALLOWLIST.has(style.cursor)) {
        return true
    }

    // Special compatibility for "iPad Cursor Simulator" script
    // When the script is active, everything is cursor:none, so we must treat it as valid text
    // to prevent disabling translation on all weak interactive elements.
    if (style.cursor === "none" && document.querySelector(".__tapword_ipad_cursor_sim_v1")) {
        return true
    }

    return false
}
interface InteractiveResult {
    isInteractive: boolean
    reason?: string
    level?: "strong" | "weak"
}

function isInteractiveElementSelf(node: HTMLElement, checkCursor: boolean): InteractiveResult {
    const strongResult = getStrongInteractiveResult(node, checkCursor)
    if (strongResult.isInteractive) {
        return strongResult
    }

    return getWeakInteractiveResult(node)
}

function isInteractiveElementByClosest(node: HTMLElement): InteractiveResult & { element?: Element } {
    const strongMatch = node.closest(STRONG_INTERACTIVE_SELECTOR)
    if (strongMatch) {
        return { isInteractive: true, reason: "closest strong match", level: "strong", element: strongMatch }
    }

    if (node.closest(`[${CLICK_ATTRIBUTE}]`)) {
        return {
            isInteractive: true,
            reason: "closest onclick",
            level: "weak",
            element: node.closest(`[${CLICK_ATTRIBUTE}]`)!,
        }
    }

    let current: HTMLElement | null = node
    while (current && current !== document.body) {
        if (current.hasAttribute(TABINDEX_ATTRIBUTE)) {
            const tabIndex = parseInt(current.getAttribute(TABINDEX_ATTRIBUTE) || "-1", 10)
            if (tabIndex >= 0) {
                return { isInteractive: true, reason: "ancestor tabindex", level: "weak", element: current }
            }
        }
        current = current.parentElement
    }

    const style = window.getComputedStyle(node)
    if (style.cursor === CURSOR_POINTER) {
        return { isInteractive: true, reason: "cursor: pointer", level: "strong", element: node }
    }

    return { isInteractive: false }
}

function getStrongInteractiveResult(node: HTMLElement, checkCursor: boolean): InteractiveResult {
    if (node.matches(STRONG_INTERACTIVE_TAG_SELECTOR)) {
        return { isInteractive: true, reason: `tag: ${node.tagName}`, level: "strong" }
    }

    if (node.matches(STRONG_INTERACTIVE_ROLE_SELECTOR)) {
        return { isInteractive: true, reason: `role: ${node.getAttribute("role")}`, level: "strong" }
    }

    if (checkCursor) {
        const style = window.getComputedStyle(node)
        if (style.cursor === CURSOR_POINTER) {
            return { isInteractive: true, reason: "cursor: pointer", level: "strong" }
        }
    }

    return { isInteractive: false }
}

function getWeakInteractiveResult(node: HTMLElement): InteractiveResult {
    if (node.hasAttribute(CLICK_ATTRIBUTE)) {
        return { isInteractive: true, reason: "onclick attribute", level: "weak" }
    }

    if (node.hasAttribute(TABINDEX_ATTRIBUTE)) {
        const tabIndex = parseInt(node.getAttribute(TABINDEX_ATTRIBUTE) || "-1", 10)
        if (tabIndex >= 0) {
            return { isInteractive: true, reason: `tabindex: ${tabIndex}`, level: "weak" }
        }
    }

    return { isInteractive: false }
}