import * as loggerModule from "@/0_common/utils/logger"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("getSelectedText")

export const getSelectedTextTool: ToolRegistration = {
    definition: {
        name: "get_selected_text",
        description:
            "Get the text currently selected by the user on the active webpage, along with the surrounding sentence context and containing block text. " +
            "Returns the selected text, contextual sentence, and full block text, or empty strings if nothing is selected. " +
            "Use this when the user refers to 'selected text', 'highlighted text', or 'the text I selected'.",
        input_schema: {
            type: "object" as const,
            properties: {},
            required: [] as string[],
        },
    },
    label: "Reading selection...",
    descriptionCN: "获取用户在网页上选中的文本及上下文",
    execute: async () => {
        let response: unknown
        try {
            response = await chrome.runtime.sendMessage({ type: "GET_SELECTED_TEXT" })
        } catch (error) {
            logger.error("Failed to get selected text:", error)
            throw new Error(`Failed to send message to background: ${error instanceof Error ? error.message : String(error)}`)
        }
        const typed = response as { success?: boolean; text?: string; contextText?: string; blockText?: string; error?: string } | undefined
        if (typed?.success) {
            const text = typed.text ?? ""
            const contextText = typed.contextText ?? ""
            const blockText = typed.blockText ?? ""
            logger.info(`Selected text received: ${text.length} chars, context: ${contextText.length} chars, block: ${blockText.length} chars`)
            if (!text) return ""
            const parts = [`Selected text: ${text}`]
            if (contextText) parts.push(`Context (sentence): ${contextText}`)
            if (blockText && blockText !== contextText) parts.push(`Block text: ${blockText}`)
            return parts.join("\n\n")
        }
        logger.warn("Failed to get selected text:", typed?.error)
        throw new Error(typed?.error || "Failed to get selected text")
    },
}

// Self-register with the global tool registry
import { toolRegistry } from "./ToolRegistry"
toolRegistry.add(getSelectedTextTool)
