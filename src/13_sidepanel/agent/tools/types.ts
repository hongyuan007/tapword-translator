import type Anthropic from "@anthropic-ai/sdk"

/**
 * A single registered tool: definition + label + executor.
 */
export interface ToolRegistration {
    definition: Anthropic.Tool
    label: string
    execute: (input: Record<string, unknown>) => Promise<string>
}
