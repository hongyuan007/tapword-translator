import * as loggerModule from "@/0_common/utils/logger"
import type { TodoItem, TodoStatus } from "../types"

const logger = loggerModule.createLogger("TodoManager")

/** Maximum number of todo items allowed. */
const MAX_TODO_ITEMS = 20

/** Maximum number of in_progress items allowed simultaneously. */
const MAX_IN_PROGRESS_ITEMS = 1

/** Valid status values. */
const VALID_STATUSES: readonly TodoStatus[] = ["pending", "in_progress", "completed"]

/** Status markers for text rendering. */
const STATUS_MARKERS: Record<TodoStatus, string> = {
    pending: "[ ]",
    in_progress: "[>]",
    completed: "[x]",
}

/** Public API for TodoManager. */
export interface ITodoManager {
    setOnChange(cb: (items: readonly TodoItem[], isTaskCompleted: boolean) => void): void
    createTodos(rawItems: Array<Record<string, unknown>>): string
    updateTodoStatus(id: string, status: TodoStatus): string
    completeTask(): string
    getItems(): readonly TodoItem[]
    readonly isTaskCompleted: boolean
    render(): string
    restore(items: TodoItem[], isTaskCompleted: boolean): void
    clear(): void
}

export class TodoManager implements ITodoManager {
    private items: TodoItem[] = []
    private _isTaskCompleted: boolean = false
    private onChange?: (items: readonly TodoItem[], isTaskCompleted: boolean) => void

    /** Set the callback invoked whenever todo state changes. */
    setOnChange(cb: (items: readonly TodoItem[], isTaskCompleted: boolean) => void): void {
        this.onChange = cb
    }

    /** Replace-all: creates a new set of todos (starts a new task). */
    createTodos(rawItems: Array<Record<string, unknown>>): string {
        const validated = this.validate(rawItems)
        this.items = validated
        this._isTaskCompleted = false
        logger.info(`Created ${validated.length} todo items`)
        this.notifyChange()
        return this.render()
    }

    /** Update a single item's status by ID. */
    updateTodoStatus(id: string, status: TodoStatus): string {
        if (!VALID_STATUSES.includes(status)) {
            throw new Error(`Invalid status "${status}". Must be one of: ${VALID_STATUSES.join(", ")}.`)
        }

        const item = this.items.find((i) => i.id === id)
        if (!item) {
            throw new Error(`Todo item with id "${id}" not found.`)
        }

        // Validate max in_progress constraint
        if (status === "in_progress") {
            const currentInProgress = this.items.filter((i) => i.id !== id && i.status === "in_progress").length
            if (currentInProgress >= MAX_IN_PROGRESS_ITEMS) {
                throw new Error(`Only ${MAX_IN_PROGRESS_ITEMS} item can be in_progress at a time.`)
            }
        }

        item.status = status
        logger.info(`Updated todo #${id} status to ${status}`)
        this.notifyChange()
        return this.render()
    }

    /** Mark the entire task as completed. */
    completeTask(): string {
        this._isTaskCompleted = true
        logger.info("Task marked as completed")
        this.notifyChange()
        return "Task marked as completed."
    }

    /** Get current items (readonly copy). */
    getItems(): readonly TodoItem[] {
        return [...this.items]
    }

    /** Whether the entire task is completed. */
    get isTaskCompleted(): boolean {
        return this._isTaskCompleted
    }

    /** Render items as text for LLM context. */
    render(): string {
        if (this.items.length === 0) {
            return "(no tasks)"
        }

        const lines = this.items.map((item) => `${STATUS_MARKERS[item.status]} #${item.id}: ${item.title}`)
        const completed = this.items.filter((item) => item.status === "completed").length
        lines.push("")
        lines.push(`(${completed}/${this.items.length} completed)`)
        if (this._isTaskCompleted) {
            lines.push("\n✅ Task completed")
        }
        return lines.join("\n")
    }

    /** Restore items from persistence (no validation, no callback). */
    restore(items: TodoItem[], isTaskCompleted: boolean): void {
        this.items = [...items]
        this._isTaskCompleted = isTaskCompleted
        logger.info(`Restored ${items.length} todo items, taskCompleted=${isTaskCompleted}`)
    }

    /** Clear all items. Calls onChange. */
    clear(): void {
        this.items = []
        this._isTaskCompleted = false
        this.onChange?.([], false)
        logger.info("Todo items cleared")
    }

    private notifyChange(): void {
        this.onChange?.([...this.items], this._isTaskCompleted)
    }

    private validate(rawItems: Array<Record<string, unknown>>): TodoItem[] {
        if (!Array.isArray(rawItems)) {
            throw new Error("items must be an array")
        }

        if (rawItems.length > MAX_TODO_ITEMS) {
            throw new Error(`Too many items: ${rawItems.length}. Maximum is ${MAX_TODO_ITEMS}.`)
        }

        const validated: TodoItem[] = []
        let inProgressCount = 0

        for (let i = 0; i < rawItems.length; i++) {
            const raw = rawItems[i]!

            const id = String(raw.id ?? "").trim()
            if (!id) {
                throw new Error(`Item at index ${i}: id is required and must be a non-empty string.`)
            }

            const title = String(raw.title ?? "").trim()
            if (!title) {
                throw new Error(`Item #${id}: title is required and must be a non-empty string.`)
            }

            const description = raw.description ? String(raw.description).trim() : undefined

            const status = String(raw.status ?? "") as TodoStatus
            if (!VALID_STATUSES.includes(status)) {
                throw new Error(`Item #${id}: invalid status "${raw.status}". Must be one of: ${VALID_STATUSES.join(", ")}.`)
            }

            if (status === "in_progress") {
                inProgressCount++
                if (inProgressCount > MAX_IN_PROGRESS_ITEMS) {
                    throw new Error(`Item #${id}: only ${MAX_IN_PROGRESS_ITEMS} item can be in_progress at a time.`)
                }
            }

            validated.push({ id, title, description, status })
        }

        return validated
    }
}

/** Module-level singleton instance. */
export const todoManager = new TodoManager()
