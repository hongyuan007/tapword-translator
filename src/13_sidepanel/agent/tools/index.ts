import { getCurrentPageTool } from "./getCurrentPageTool"
import { searchKnowledgeTool, storeKnowledgeTool } from "./knowledgeTools"
import { loadSkillTool } from "./skillTools"
import { readFileTool, listDirectoryTool, writeFileTool, deleteFileTool, deleteDirectoryTool } from "./fileTools"
import { fetchUrlTool } from "./fetchUrlTool"
import { searchFilesTool } from "./searchFilesTool"
import { createTodosTool, updateTodoStatusTool, completeTodosTool } from "./todoTools"
import { toolRegistry } from "./ToolRegistry"

/** Tool names related to todo management. */
export const TODO_TOOL_NAMES = new Set([createTodosTool.definition.name, updateTodoStatusTool.definition.name, completeTodosTool.definition.name])

// Register all built-in tools
toolRegistry.add(getCurrentPageTool)
toolRegistry.add(searchKnowledgeTool)
toolRegistry.add(storeKnowledgeTool)
toolRegistry.add(createTodosTool)
toolRegistry.add(updateTodoStatusTool)
toolRegistry.add(completeTodosTool)
toolRegistry.add(loadSkillTool)
toolRegistry.add(readFileTool)
toolRegistry.add(listDirectoryTool)
toolRegistry.add(writeFileTool)
toolRegistry.add(deleteFileTool)
toolRegistry.add(deleteDirectoryTool)
toolRegistry.add(fetchUrlTool)
toolRegistry.add(searchFilesTool)

export { toolRegistry }
export type { ToolRegistration } from "./types"
