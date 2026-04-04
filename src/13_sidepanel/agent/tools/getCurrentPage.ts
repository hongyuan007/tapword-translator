import * as loggerModule from "@/0_common/utils/logger"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("getCurrentPage")

export const getCurrentPageTool: ToolRegistration = {
    definition: {
        name: "get_current_page",
        description: "Get the text content of the currently active webpage. Use this when the user asks about the current page.",
        input_schema: {
            type: "object" as const,
            properties: {},
            required: [] as string[],
        },
    },
    label: "Reading page...",
    execute: async () => {
        let response: unknown
        try {
            response = await chrome.runtime.sendMessage({ type: "GET_PAGE_CONTENT" })
        } catch (error) {
            logger.error("Failed to get page content:", error)
            throw new Error(`Failed to send message to background: ${error instanceof Error ? error.message : String(error)}`)
        }
        const typed = response as { success?: boolean; content?: string; error?: string } | undefined
        if (typed?.success) {
            const content = typed.content ?? ""
            logger.info(`Page content received: ${content.length} chars`)
            return content
        }
        logger.warn("Failed to get page content:", typed?.error)
        throw new Error(typed?.error || "Failed to get page content")
    },
}
