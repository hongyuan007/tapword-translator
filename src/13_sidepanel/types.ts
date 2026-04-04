// Shared types for the sidepanel module

export interface ChatMessage {
    role: "user" | "assistant"
    content: string
    toolCalls?: string[]
    isError?: boolean
}
