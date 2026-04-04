import * as loggerModule from "@/0_common/utils/logger"
import type { TodoStatus } from "../../types"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("todoTools")

// --- createTodos ---

export const createTodosTool: ToolRegistration = {
    definition: {
        name: "create_todos",
        description:
            "Create a plan for a multi-step task. Replaces any existing todo list. " +
            "Use this to plan work before starting. Each item has a short title (shown to user) " +
            "and optional description (your internal guidance).",
        input_schema: {
            type: "object" as const,
            properties: {
                items: {
                    type: "array",
                    description: "The complete list of todo items.",
                    items: {
                        type: "object",
                        properties: {
                            id: {
                                type: "string",
                                description: "Unique ID (e.g. '1', '2').",
                            },
                            title: {
                                type: "string",
                                description: "Short task label shown to user (3-7 words).",
                            },
                            description: {
                                type: "string",
                                description: "Detailed guidance for yourself (not shown to user).",
                            },
                            status: {
                                type: "string",
                                enum: ["pending", "in_progress", "completed"],
                                description: "Current status.",
                            },
                        },
                        required: ["id", "title", "status"],
                    },
                },
            },
            required: ["items"],
        },
    },
    label: "Planning tasks...",
    execute: async (input, context) => {
        if (!context.todoManager) {
            throw new Error("TodoManager is not available in tool context.")
        }
        const rendered = context.todoManager.createTodos(input.items as Array<Record<string, unknown>>)
        logger.info("Todo list created successfully")
        return rendered
    },
}

// --- updateTodoStatus ---

export const updateTodoStatusTool: ToolRegistration = {
    definition: {
        name: "update_todo_status",
        description:
            "Update the status of a single todo item. " +
            "Use this to mark an item as in_progress before starting work, or completed when done.",
        input_schema: {
            type: "object" as const,
            properties: {
                id: {
                    type: "string",
                    description: "The ID of the todo item to update.",
                },
                status: {
                    type: "string",
                    enum: ["pending", "in_progress", "completed"],
                    description: "New status.",
                },
            },
            required: ["id", "status"],
        },
    },
    label: "Updating task status...",
    execute: async (input, context) => {
        if (!context.todoManager) {
            throw new Error("TodoManager is not available in tool context.")
        }
        const rendered = context.todoManager.updateTodoStatus(input.id as string, input.status as TodoStatus)
        logger.info(`Todo #${input.id} updated to ${input.status}`)
        return rendered
    },
}

// --- completeTodos ---

export const completeTodosTool: ToolRegistration = {
    definition: {
        name: "complete_task",
        description: "Mark the entire task as completed. Call this after all todo items are done to signal task completion to the user.",
        input_schema: {
            type: "object" as const,
            properties: {},
            required: [],
        },
    },
    label: "Completing task...",
    execute: async (_input, context) => {
        if (!context.todoManager) {
            throw new Error("TodoManager is not available in tool context.")
        }
        const result = context.todoManager.completeTask()
        logger.info("Task completed")
        return result
    },
}
