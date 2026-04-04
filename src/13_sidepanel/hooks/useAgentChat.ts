import { useState, useEffect, useRef, useCallback } from "react"
import * as loggerModule from "@/0_common/utils/logger"
import { AgentLoop, AgentError } from "../agent/AgentLoop"
import type { KnowledgeStore } from "../store/KnowledgeStore"
import type { ChatMessage } from "../types"
import * as storageService from "../services/StorageService"

const logger = loggerModule.createLogger("useAgentChat")

interface UseAgentChatResult {
    messages: ChatMessage[]
    isLoading: boolean
    activeTool: string | null
    showAuthError: boolean
    sendMessage: (text: string) => Promise<void>
    clearChat: () => void
    dismissAuthError: () => void
}

export function useAgentChat(apiKey: string | null, knowledgeStore: KnowledgeStore): UseAgentChatResult {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [activeTool, setActiveTool] = useState<string | null>(null)
    const [showAuthError, setShowAuthError] = useState(false)

    const agentRef = useRef<AgentLoop | null>(null)
    const loadedMessagesRef = useRef<ChatMessage[] | null>(null)

    // Load session messages on mount
    useEffect(() => {
        loadPersistedMessages()
    }, [])

    // Recreate AgentLoop when apiKey changes
    useEffect(() => {
        if (apiKey) {
            const agent = new AgentLoop(apiKey, knowledgeStore)
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

    const sendMessage = useCallback(
        async (text: string) => {
            if (!text || isLoading || !agentRef.current) return

            const userMessage: ChatMessage = { role: "user", content: text }
            setMessages((prev) => [...prev, userMessage])
            setIsLoading(true)
            setActiveTool(null)
            setShowAuthError(false)

            // Add a placeholder assistant message
            const assistantIndex = messages.length + 1
            setMessages((prev) => [...prev, { role: "assistant", content: "", toolCalls: [] }])

            try {
                await agentRef.current.runAgent(
                    text,
                    // onTextUpdate: replace the assistant message content
                    (updatedText) => {
                        setMessages((prev) => {
                            const updated = [...prev]
                            const current = updated[assistantIndex]!
                            updated[assistantIndex] = { ...current, content: updatedText }
                            return updated
                        })
                    },
                    // onToolUse: show indicator and record tool call
                    (toolLabel) => {
                        setActiveTool(toolLabel)
                        setMessages((prev) => {
                            const updated = [...prev]
                            const msg = updated[assistantIndex]!
                            const calls = msg.toolCalls || []
                            if (!calls.includes(toolLabel)) {
                                updated[assistantIndex] = { ...msg, toolCalls: [...calls, toolLabel] }
                            }
                            return updated
                        })
                    }
                )
            } catch (error) {
                const isAuthErr = error instanceof AgentError && error.isAuthError
                const errorMsg = error instanceof Error ? error.message : String(error)
                logger.error("Agent request failed:", error)
                setMessages((prev) => {
                    const updated = [...prev]
                    const current = updated[assistantIndex]!
                    updated[assistantIndex] = { ...current, content: errorMsg, isError: true }
                    return updated
                })
                if (isAuthErr) {
                    setShowAuthError(true)
                }
            } finally {
                setIsLoading(false)
                setActiveTool(null)
            }
        },
        [isLoading, messages.length]
    )

    function clearChat() {
        agentRef.current?.clearHistory()
        setMessages([])
        setShowAuthError(false)
        storageService.clearSessionMessages()
    }

    function dismissAuthError() {
        setShowAuthError(false)
    }

    return { messages, isLoading, activeTool, showAuthError, sendMessage, clearChat, dismissAuthError }
}
