import * as loggerModule from "@/0_common/utils/logger"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("ToolRegistry")

/** Public API for the centralized tool registry. */
export interface IToolRegistry {
    add(tool: ToolRegistration): void
    get(name: string): ToolRegistration | undefined
    getAll(): Map<string, ToolRegistration>
    has(name: string): boolean
    readonly size: number
}

/** Centralized registry that holds all available agent tools. */
export class ToolRegistry implements IToolRegistry {
    private readonly tools = new Map<string, ToolRegistration>()

    /** Register a tool; warns and skips on duplicate name. */
    add(tool: ToolRegistration): void {
        const name = tool.definition.name
        if (this.tools.has(name)) {
            logger.warn(`Duplicate tool registration ignored: "${name}"`)
            return
        }
        this.tools.set(name, tool)
    }

    /** Retrieve a tool by name. */
    get(name: string): ToolRegistration | undefined {
        return this.tools.get(name)
    }

    /** Returns a defensive copy of the internal map. */
    getAll(): Map<string, ToolRegistration> {
        return new Map(this.tools)
    }

    /** Check whether a tool with the given name is registered. */
    has(name: string): boolean {
        return this.tools.has(name)
    }

    get size(): number {
        return this.tools.size
    }
}

export const toolRegistry = new ToolRegistry()
