import type Anthropic from "@anthropic-ai/sdk"

/** Tool category for UI display and filtering. */
export type ToolCategory = "builtin" | "capability" | "skill"

/**
 * A single registered tool: definition + label + executor.
 */
export interface ToolRegistration {
    definition: Anthropic.Tool
    label: string
    descriptionCN?: string
    /** Tool category. Defaults to "builtin" if not specified. */
    category?: ToolCategory
    execute: (input: Record<string, unknown>) => Promise<string>
}
