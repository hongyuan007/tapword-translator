import { useState, useEffect, useRef, useCallback } from "react"
import * as loggerModule from "@/0_common/utils/logger"
import { AgentLoop, AgentError } from "../agent/AgentLoop"
import * as embeddingClient from "../api/EmbeddingClient"
import { todoManager } from "../store/TodoManager"
import type { ChatMessage, TodoItem, AgentCallbacks, ContentBlock, TextBlock, ToolCallBlock } from "../types"
import * as storageService from "../services/StorageService"

const logger = loggerModule.createLogger("useAgentChat")

type StreamPhase = "idle" | "thinking" | "text"

interface UseAgentChatResult {
    messages: ChatMessage[]
    isLoading: boolean
    showAuthError: boolean
    todoItems: readonly TodoItem[]
    isTaskCompleted: boolean
    sendMessage: (text: string) => Promise<void>
    clearChat: () => void
    dismissAuthError: () => void
}

export function useAgentChat(apiKey: string | null): UseAgentChatResult {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [showAuthError, setShowAuthError] = useState(false)
    const [todoItems, setTodoItems] = useState<readonly TodoItem[]>([])
    const [isTaskCompleted, setIsTaskCompleted] = useState(false)

    const agentRef = useRef<AgentLoop | null>(null)
    const loadedMessagesRef = useRef<ChatMessage[] | null>(null)
    const phaseRef = useRef<StreamPhase>("idle")

    // Load session messages and todos on mount; wire up TodoManager callback
    useEffect(() => {
        todoManager.setOnChange((items, taskCompleted) => {
            setTodoItems(items)
            setIsTaskCompleted(taskCompleted)
            storageService.saveSessionTodos(items, taskCompleted)
        })
        loadPersistedMessages()
        loadPersistedTodos()
    }, [])

    // Recreate AgentLoop when apiKey changes
    useEffect(() => {
        if (apiKey) {
            embeddingClient.setApiKey(apiKey)
            const agent = new AgentLoop(apiKey)
            agentRef.current = agent
            // Restore LLM history from persisted messages
            if (loadedMessagesRef.current && loadedMessagesRef.current.length > 0) {
                agent.restoreHistory(loadedMessagesRef.current.filter((m) => !m.isError).map((m) => ({ role: m.role, content: m.content })))
                loadedMessagesRef.current = null
            }
        } else {
            agentRef.current = null
        }
    }, [apiKey])

    // Persist messages to session storage after interaction completes
    useEffect(() => {
        if (!isLoading && messages.length > 0) {
            storageService.saveSessionMessages(messages)
        }
    }, [messages, isLoading])

    async function loadPersistedMessages() {
        const saved = await storageService.loadSessionMessages()
        if (saved.length > 0) {
            setMessages(saved)
            loadedMessagesRef.current = saved
        }
    }

    async function loadPersistedTodos() {
        const saved = await storageService.loadSessionTodos()
        if (saved.items.length > 0) {
            todoManager.restore(saved.items, saved.isTaskCompleted)
            setTodoItems(saved.items)
            setIsTaskCompleted(saved.isTaskCompleted)
        }
    }

    const sendMessage = useCallback(
        async (text: string) => {
            if (!text || isLoading || !agentRef.current) return

            phaseRef.current = "idle"

            const userMessage: ChatMessage = { role: "user", content: text }
            setMessages((prev) => [...prev, userMessage])
            setIsLoading(true)
            setShowAuthError(false)

            // Add a placeholder assistant message with empty blocks
            const assistantIndex = messages.length + 1
            setMessages((prev) => [...prev, { role: "assistant", content: "", blocks: [] }])

            // ─── Block manipulation helpers ───────────────────────────

            function appendBlock(block: ContentBlock): void {
                setMessages((prev) => {
                    const updated = [...prev]
                    const msg = updated[assistantIndex]!
                    const blocks = [...(msg.blocks || []), block]
                    updated[assistantIndex] = { ...msg, blocks }
                    return updated
                })
            }

            function updateLastBlock(patch: Partial<ContentBlock>): void {
                setMessages((prev) => {
                    const updated = [...prev]
                    const msg = updated[assistantIndex]!
                    const blocks = [...(msg.blocks || [])]
                    const lastIdx = blocks.length - 1
                    if (lastIdx >= 0) {
                        blocks[lastIdx] = { ...blocks[lastIdx], ...patch } as ContentBlock
                    }
                    updated[assistantIndex] = { ...msg, blocks }
                    return updated
                })
            }

            function updateToolBlock(toolCallId: string, patch: Partial<ToolCallBlock>): void {
                setMessages((prev) => {
                    const updated = [...prev]
                    const msg = updated[assistantIndex]!
                    const blocks = (msg.blocks || []).map((b) => (b.type === "tool_call" && b.toolCallId === toolCallId ? { ...b, ...patch } : b))
                    updated[assistantIndex] = { ...msg, blocks }
                    return updated
                })
            }

            try {
                const agentCallbacks: AgentCallbacks = {
                    onThinkingUpdate: (_delta, snapshot) => {
                        if (phaseRef.current !== "thinking") {
                            phaseRef.current = "thinking"
                            appendBlock({ type: "thinking", content: snapshot, isStreaming: true })
                        } else {
                            updateLastBlock({ content: snapshot })
                        }
                    },
                    onThinkingComplete: () => {
                        updateLastBlock({ isStreaming: false })
                        phaseRef.current = "idle"
                    },
                    onTextUpdate: (_delta, snapshot) => {
                        if (phaseRef.current !== "text") {
                            phaseRef.current = "text"
                            appendBlock({ type: "text", content: snapshot, isStreaming: true })
                        } else {
                            updateLastBlock({ content: snapshot })
                        }
                    },
                    onToolCallStart: (toolCallId, toolName, toolLabel, input) => {
                        phaseRef.current = "idle"
                        appendBlock({
                            type: "tool_call",
                            toolCallId,
                            toolName,
                            toolLabel,
                            input,
                            status: "running",
                        })
                    },
                    onToolCallComplete: (toolCallId, result, isError) => {
                        updateToolBlock(toolCallId, {
                            result,
                            isError,
                            status: isError ? "error" : "completed",
                        })
                    },
                }

                await agentRef.current.runAgent(text, agentCallbacks)

                // Post-loop content denormalization
                setMessages((prev) => {
                    const updated = [...prev]
                    const msg = updated[assistantIndex]!
                    const blocks = msg.blocks || []

                    // Denormalize: join all text block contents
                    const content = blocks
                        .filter((b): b is TextBlock => b.type === "text")
                        .map((b) => b.content)
                        .join("\n\n")

                    // Mark all blocks as not streaming
                    const finalBlocks = blocks.map((b) => ("isStreaming" in b ? { ...b, isStreaming: false } : b))

                    updated[assistantIndex] = { ...msg, content, blocks: finalBlocks }
                    return updated
                })
            } catch (error) {
                const isAuthErr = error instanceof AgentError && error.isAuthError
                const errorMsg = error instanceof Error ? error.message : String(error)
                logger.error("Agent request failed:", error)
                setMessages((prev) => {
                    const updated = [...prev]
                    const current = updated[assistantIndex]!
                    updated[assistantIndex] = {
                        ...current,
                        content: errorMsg,
                        isError: true,
                    }
                    return updated
                })
                if (isAuthErr) {
                    setShowAuthError(true)
                }
            } finally {
                setIsLoading(false)
            }
        },
        [isLoading, messages.length]
    )

    function clearChat() {
        agentRef.current?.clearHistory()
        setMessages([])
        setShowAuthError(false)
        storageService.clearSessionMessages()
        todoManager.clear()
        setTodoItems([])
        setIsTaskCompleted(false)
        storageService.clearSessionTodos()
    }

    function dismissAuthError() {
        setShowAuthError(false)
    }

    return {
        messages,
        isLoading,
        showAuthError,
        todoItems,
        isTaskCompleted,
        sendMessage,
        clearChat,
        dismissAuthError,
    }
}
