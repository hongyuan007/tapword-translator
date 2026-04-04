import type { ToolRegistration } from "./types"
import { getCurrentPageTool } from "./getCurrentPage"
import { searchKnowledgeTool, storeKnowledgeTool } from "./knowledgeTools"
import { createTodosTool, updateTodoStatusTool, completeTodosTool } from "./todoTools"

/** Tool names related to todo management. */
export const TODO_TOOL_NAMES = new Set([createTodosTool.definition.name, updateTodoStatusTool.definition.name, completeTodosTool.definition.name])

/** All registered tools, keyed by tool name. */
const TOOL_REGISTRY = new Map<string, ToolRegistration>([
    [getCurrentPageTool.definition.name, getCurrentPageTool],
    [searchKnowledgeTool.definition.name, searchKnowledgeTool],
    [storeKnowledgeTool.definition.name, storeKnowledgeTool],
    [createTodosTool.definition.name, createTodosTool],
    [updateTodoStatusTool.definition.name, updateTodoStatusTool],
    [completeTodosTool.definition.name, completeTodosTool],
])

export { TOOL_REGISTRY }
export type { ToolRegistration } from "./types"
