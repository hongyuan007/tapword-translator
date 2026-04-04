import type { ToolRegistration } from "./types"
import { getCurrentPageTool } from "./getCurrentPage"
import { searchKnowledgeTool } from "./searchKnowledge"
import { storeKnowledgeTool } from "./storeKnowledge"

/** All registered tools, keyed by tool name. */
const TOOL_REGISTRY = new Map<string, ToolRegistration>([
    [getCurrentPageTool.definition.name, getCurrentPageTool],
    [searchKnowledgeTool.definition.name, searchKnowledgeTool],
    [storeKnowledgeTool.definition.name, storeKnowledgeTool],
])

export { TOOL_REGISTRY }
export type { ToolRegistration, ToolContext } from "./types"
