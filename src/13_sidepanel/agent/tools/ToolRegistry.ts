import * as loggerModule from "@/0_common/utils/logger"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("ToolRegistry")

const DISABLED_TOOLS_STORAGE_KEY = "tapword_disabled_tools"

/** Public API for the centralized tool registry. */
export interface IToolRegistry {
    add(tool: ToolRegistration): void
    get(name: string): ToolRegistration | undefined
    getAll(): Map<string, ToolRegistration>
    getEnabled(): Map<string, ToolRegistration>
    has(name: string): boolean
    enable(name: string): void
    disable(name: string): void
    isEnabled(name: string): boolean
    readonly size: number
}

/** Centralized registry that holds all available agent tools. */
export class ToolRegistry implements IToolRegistry {
    private readonly tools = new Map<string, ToolRegistration>()
    private readonly disabledTools = new Set<string>()

    constructor() {
        this.loadDisabledState()
    }

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

    /** Returns a defensive copy of ALL tools (enabled + disabled) — for UI listing. */
    getAll(): Map<string, ToolRegistration> {
        return new Map(this.tools)
    }

    /** Returns only enabled tools — for agent invocation. */
    getEnabled(): Map<string, ToolRegistration> {
        const result = new Map<string, ToolRegistration>()
        for (const [name, tool] of this.tools) {
            if (!this.disabledTools.has(name)) {
                result.set(name, tool)
            }
        }
        return result
    }

    /** Check whether a tool with the given name is registered. */
    has(name: string): boolean {
        return this.tools.has(name)
    }

    /** Enable a tool by name. */
    enable(name: string): void {
        this.disabledTools.delete(name)
        this.persistDisabledState()
    }

    /** Disable a tool by name. */
    disable(name: string): void {
        this.disabledTools.add(name)
        this.persistDisabledState()
    }

    /** Check whether a tool is enabled (not in the disabled set). */
    isEnabled(name: string): boolean {
        return !this.disabledTools.has(name)
    }

    get size(): number {
        return this.tools.size
    }

    /** Load disabled tool names from localStorage. */
    private loadDisabledState(): void {
        try {
            const stored = localStorage.getItem(DISABLED_TOOLS_STORAGE_KEY)
            if (stored) {
                const names: string[] = JSON.parse(stored)
                for (const name of names) {
                    this.disabledTools.add(name)
                }
                logger.info(`Loaded ${names.length} disabled tools from storage`)
            }
        } catch (err) {
            logger.warn("Failed to load disabled tools from storage:", err)
        }
    }

    /** Persist disabled tool names to localStorage. */
    private persistDisabledState(): void {
        try {
            const names = Array.from(this.disabledTools)
            localStorage.setItem(DISABLED_TOOLS_STORAGE_KEY, JSON.stringify(names))
        } catch (err) {
            logger.warn("Failed to persist disabled tools to storage:", err)
        }
    }
}

export const toolRegistry = new ToolRegistry()
