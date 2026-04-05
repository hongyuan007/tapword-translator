import { useState, useEffect, useRef, useCallback } from "react"
import * as loggerModule from "@/0_common/utils/logger"
import { AgentLoop, AgentError, AgentAbortError } from "../agent/AgentLoop"
import type { McpToolCallbacks } from "../agent/AgentLoop"
import * as embeddingClient from "../api/EmbeddingClient"
import * as storageManagerModule from "@/0_common/utils/storageManager"
import { todoManager } from "@/13_sidepanel/services/TodoManager"
import type { ChatMessage, TodoItem, AgentCallbacks, ContentBlock, TextBlock, CompactionBlock, ContextUsage } from "../types"
import { storageService } from "@/13_sidepanel/services/StorageService"

const logger = loggerModule.createLogger("useAgentChat")

type StreamPhase = "idle" | "thinking" | "text"

interface UseAgentChatResult {
    messages: ChatMessage[]
    isLoading: boolean
    showAuthError: boolean
    todoItems: readonly TodoItem[]
    isTaskCompleted: boolean
    contextUsage: ContextUsage | null
    sendMessage: (text: string) => Promise<void>
    abortAgent: () => void
    clearChat: () => void
    dismissAuthError: () => void
}

export function useAgentChat(apiKey: string | null, mcpCallbacks?: McpToolCallbacks): UseAgentChatResult {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [showAuthError, setShowAuthError] = useState(false)
    const [todoItems, setTodoItems] = useState<readonly TodoItem[]>([])
    const [isTaskCompleted, setIsTaskCompleted] = useState(false)
    const [contextUsage, setContextUsage] = useState<ContextUsage | null>(null)

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

    // Recreate AgentLoop when apiKey or mcpCallbacks changes
    useEffect(() => {
        if (apiKey) {
            embeddingClient.setApiKey(apiKey)
            storageManagerModule.getUserSettings().then((settings) => {
                const model = settings.agentSettings?.model || import.meta.env.VITE_AGENT_MODEL || ""
                const agent = new AgentLoop(apiKey, mcpCallbacks, model)
                agentRef.current = agent
                // Restore LLM history from persisted messages
                if (loadedMessagesRef.current && loadedMessagesRef.current.length > 0) {
                    agent.restoreHistory(loadedMessagesRef.current.filter((m) => !m.isError).map((m) => ({ role: m.role, content: m.content })))
                    loadedMessagesRef.current = null
                }
            })
        } else {
            agentRef.current = null
        }
    }, [apiKey, mcpCallbacks])

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
            let assistantIndex = messages.length + 1
            setMessages((prev) => [...prev, { role: "assistant", content: "", blocks: [] }])

            // ─── Block manipulation helpers ───────────────────────────

            function appendBlock(block: ContentBlock): void {
                setMessages((prev) => {
                    if (assistantIndex >= prev.length) return prev
                    const updated = [...prev]
                    const msg = updated[assistantIndex]!
                    const blocks = [...(msg.blocks || []), block]
                    updated[assistantIndex] = { ...msg, blocks }
                    return updated
                })
            }

            function updateLastBlock(patch: Partial<ContentBlock>): void {
                setMessages((prev) => {
                    if (assistantIndex >= prev.length) return prev
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

            /** Finalize the current streaming block (set isStreaming=false) before starting a new phase. */
            function finalizeCurrentStreamingBlock(): void {
                if (phaseRef.current === "text" || phaseRef.current === "thinking") {
                    updateLastBlock({ isStreaming: false })
                }
            }



            try {
                const agentCallbacks: AgentCallbacks = {
                    onThinkingUpdate: (_delta, snapshot) => {
                        if (phaseRef.current !== "thinking") {
                            finalizeCurrentStreamingBlock()
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
                            finalizeCurrentStreamingBlock()
                            phaseRef.current = "text"
                            appendBlock({ type: "text", content: snapshot, isStreaming: true })
                        } else {
                            updateLastBlock({ content: snapshot })
                        }
                    },
                    onToolCallStart: (toolCallId, toolName, toolLabel, input) => {
                        finalizeCurrentStreamingBlock()
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
                        const completedStatus = isError ? "error" as const : "completed" as const
                        // Handle both regular ToolCallBlock and SubagentBlock completion
                        setMessages((prev) => {
                            if (assistantIndex >= prev.length) return prev
                            const updated = [...prev]
                            const msg = updated[assistantIndex]!
                            const blocks = (msg.blocks || []).map((b) => {
                                if (b.type === "subagent" && b.toolCallId === toolCallId) {
                                    return {
                                        ...b,
                                        status: completedStatus,
                                        summary: result,
                                        // Finalize all nested streaming blocks
                                        nestedBlocks: b.nestedBlocks.map((nb: ContentBlock) =>
                                            "isStreaming" in nb ? { ...nb, isStreaming: false } : nb,
                                        ),
                                    }
                                }
                                if (b.type === "tool_call" && b.toolCallId === toolCallId) {
                                    return { ...b, result, isError, status: completedStatus }
                                }
                                return b
                            })
                            updated[assistantIndex] = { ...msg, blocks }
                            return updated
                        })
                    },
                    onSubagentStart: (toolCallId, description) => {
                        finalizeCurrentStreamingBlock()
                        phaseRef.current = "idle"
                        appendBlock({
                            type: "subagent",
                            toolCallId,
                            description,
                            status: "running",
                            nestedBlocks: [],
                        })
                    },
                    onSubagentBlockUpdate: (toolCallId, updater) => {
                        setMessages((prev) => {
                            if (assistantIndex >= prev.length) return prev
                            const updated = [...prev]
                            const msg = updated[assistantIndex]!
                            const blocks = (msg.blocks || []).map((b) => {
                                if (b.type === "subagent" && b.toolCallId === toolCallId) {
                                    return {
                                        ...b,
                                        nestedBlocks: updater(b.nestedBlocks),
                                    }
                                }
                                return b
                            })
                            updated[assistantIndex] = { ...msg, blocks }
                            return updated
                        })
                    },
                    onCompactionStart: (compressedCount) => {
                        // Insert a placeholder compaction message before the current assistant message
                        const compactionBlock: CompactionBlock = {
                            type: "compaction",
                            status: "compressing",
                            summary: "",
                            timestamp: Date.now(),
                            compressedMessageCount: compressedCount,
                            tokensBefore: 0,
                            tokensAfter: 0,
                        }
                        const compactionMessage: ChatMessage = {
                            role: "assistant",
                            content: "",
                            blocks: [compactionBlock],
                        }
                        setMessages((prev) => {
                            if (assistantIndex >= prev.length) return prev
                            const updated = [...prev]
                            updated.splice(assistantIndex, 0, compactionMessage)
                            return updated
                        })
                        assistantIndex++
                    },
                    onCompactionComplete: (summary, stats) => {
                        // Find the existing "compressing" compaction message and update it to "completed"
                        setMessages((prev) => {
                            const updated = [...prev]
                            // Search backward for the last compaction message with status "compressing"
                            for (let i = updated.length - 1; i >= 0; i--) {
                                const msg = updated[i]!
                                const block = msg.blocks?.[0]
                                if (block?.type === "compaction" && block.status === "compressing") {
                                    const updatedBlock: CompactionBlock = {
                                        ...block,
                                        status: "completed",
                                        summary,
                                        compressedMessageCount: stats.compressedCount,
                                        tokensBefore: stats.tokensBefore,
                                        tokensAfter: stats.tokensAfter,
                                    }
                                    updated[i] = { ...msg, blocks: [updatedBlock] }
                                    break
                                }
                            }
                            return updated
                        })
                    },
                    onContextUsageUpdate: (usage) => {
                        console.log("[ContextUsage]", usage)
                        setContextUsage(usage)
                    },
                }

                await agentRef.current.runAgent(text, agentCallbacks)

                // Post-loop content denormalization
                setMessages((prev) => {
                    if (assistantIndex >= prev.length) return prev
                    const updated = [...prev]
                    const msg = updated[assistantIndex]!
                    const blocks = msg.blocks || []

                    // Denormalize: join all text block contents
                    const content = blocks
                        .filter((b): b is TextBlock => b.type === "text")
                        .map((b) => b.content)
                        .join("\n\n")

                    // Mark all blocks as not streaming (including nested subagent blocks)
                    const finalBlocks = blocks.map((b) => {
                        if (b.type === "subagent") {
                            return {
                                ...b,
                                nestedBlocks: b.nestedBlocks.map((nb: ContentBlock) =>
                                    "isStreaming" in nb ? { ...nb, isStreaming: false } : nb,
                                ),
                            }
                        }
                        return "isStreaming" in b ? { ...b, isStreaming: false } : b
                    })

                    updated[assistantIndex] = { ...msg, content, blocks: finalBlocks }
                    return updated
                })
            } catch (error) {
                // Abort is not an error — just finalize the UI state
                if (error instanceof AgentAbortError) {
                    logger.info("Agent aborted by user")
                    setMessages((prev) => {
                        if (assistantIndex >= prev.length) return prev
                        const updated = [...prev]
                        const msg = updated[assistantIndex]!
                        const blocks = (msg.blocks || []).map((b) => {
                            if (b.type === "subagent") {
                                return {
                                    ...b,
                                    status: b.status === "running" ? "error" as const : b.status,
                                    nestedBlocks: b.nestedBlocks.map((nb: ContentBlock) =>
                                        "isStreaming" in nb ? { ...nb, isStreaming: false } : nb,
                                    ),
                                }
                            }
                            if (b.type === "tool_call" && b.status === "running") {
                                return { ...b, status: "error" as const, result: "Aborted", isError: true }
                            }
                            return "isStreaming" in b ? { ...b, isStreaming: false } : b
                        })
                        const content = blocks
                            .filter((b): b is TextBlock => b.type === "text")
                            .map((b) => b.content)
                            .join("\n\n")
                        updated[assistantIndex] = { ...msg, content, blocks }
                        return updated
                    })
                    return
                }

                const isAuthErr = error instanceof AgentError && error.isAuthError
                const errorMsg = error instanceof Error ? error.message : String(error)
                logger.error("Agent request failed:", error)
                setMessages((prev) => {
                    if (assistantIndex >= prev.length) return prev
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
        setContextUsage(null)
        storageService.clearSessionMessages()
        todoManager.clear()
        setTodoItems([])
        setIsTaskCompleted(false)
        storageService.clearSessionTodos()
    }

    /** Abort the currently running agent invocation. */
    function abortAgent() {
        if (agentRef.current && isLoading) {
            agentRef.current.abort()
        }
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
        contextUsage,
        sendMessage,
        abortAgent,
        clearChat,
        dismissAuthError,
    }
}
