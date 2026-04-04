import type { ToolRegistration } from "./types"
import { getCurrentPageTool } from "./getCurrentPage"
import { searchKnowledgeTool, storeKnowledgeTool } from "./knowledgeTools"
import { loadSkillTool } from "./skillTools"
import { readFileTool, listDirectoryTool, writeFileTool, deleteFileTool, deleteDirectoryTool } from "./fileTools"
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
    [loadSkillTool.definition.name, loadSkillTool],
    [readFileTool.definition.name, readFileTool],
    [listDirectoryTool.definition.name, listDirectoryTool],
    [writeFileTool.definition.name, writeFileTool],
    [deleteFileTool.definition.name, deleteFileTool],
    [deleteDirectoryTool.definition.name, deleteDirectoryTool],
])

export { TOOL_REGISTRY }
export type { ToolRegistration } from "./types"
