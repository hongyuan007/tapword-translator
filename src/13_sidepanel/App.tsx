import { useState, useEffect } from "react"
import { Loader2 } from "lucide-react"
import { useApiKey } from "./hooks/useApiKey"
import { useAgentChat } from "./hooks/useAgentChat"
import { ChatHeader } from "./components/ChatHeader"
import type { SidePanelTab } from "./components/ChatHeader"
import { MessageList } from "./components/MessageList"
import { ChatInputBar } from "./components/ChatInputBar"

import { AuthBanner } from "./components/AuthBanner"
import { ApiKeySetup } from "./components/ApiKeySetup"
import { KnowledgePanel } from "./components/KnowledgePanel"
import { SkillsPanel } from "./components/SkillsPanel"
import { FileBrowserPanel } from "./components/FileBrowserPanel"
import { McpPanel } from "./components/McpPanel"
import { TodoPanel } from "./components/TodoPanel"
import { skillStorageService } from "@/13_sidepanel/services/SkillStorageService"
import { useMcpServers } from "./hooks/useMcpServers"
import type { SkillMeta } from "./types"

// --- Component ---

export default function App() {
    const [activeTab, setActiveTab] = useState<SidePanelTab>("chat")
    const [input, setInput] = useState("")
    const [skills, setSkills] = useState<SkillMeta[]>([])

    const { apiKey, isLoaded: keyLoaded } = useApiKey()
    const { serverStates, addServer, removeServer, toggleServer, toggleTool, reconnectServer, mcpCallbacks } = useMcpServers()
    const { messages, isLoading, showAuthError, todoItems, isTaskCompleted, contextUsage, sendMessage, clearChat, dismissAuthError } = useAgentChat(apiKey, mcpCallbacks)

    // Load skill metadata on mount
    useEffect(() => {
        skillStorageService.loadSkillMetas().then(setSkills)
    }, [])

    // Listen for skill-imported messages from the relay popup window
    useEffect(() => {
        const handler = (message: any) => {
            if (message?.type === "skill-imported" && message.skillMeta) {
                setSkills((prev) => [...prev.filter((s) => s.id !== message.skillMeta.id), message.skillMeta])
            }
        }
        chrome.runtime.onMessage.addListener(handler)
        return () => chrome.runtime.onMessage.removeListener(handler)
    }, [])

    const handleDeleteSkill = async (skillId: string) => {
        await skillStorageService.deleteSkill(skillId)
        setSkills((prev) => prev.filter((s) => s.id !== skillId))
    }

    const handleToggleSkill = async (skillId: string, enabled: boolean) => {
        await skillStorageService.toggleSkillEnabled(skillId, enabled)
        setSkills((prev) => prev.map((s) => (s.id === skillId ? { ...s, enabled } : s)))
    }

    async function handleSend() {
        const trimmed = input.trim()
        if (!trimmed) return
        setInput("")
        await sendMessage(trimmed)
    }

    // Wait for key loading before rendering
    if (!keyLoaded) {
        return (
            <div className="flex items-center justify-center h-screen bg-stone-50">
                <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
            </div>
        )
    }

    // API key setup screen
    if (!apiKey) {
        return <ApiKeySetup />
    }

    return (
        <div className="flex flex-col h-screen bg-stone-50 text-stone-800">
            <ChatHeader
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onClearChat={clearChat}
                showClearButton={activeTab === "chat"}
            />
            {showAuthError && (
                <AuthBanner
                    onOpenSettings={() => {
                        dismissAuthError()
                    }}
                />
            )}
            {todoItems.length > 0 && <TodoPanel items={todoItems} isTaskCompleted={isTaskCompleted} />}
            {activeTab === "knowledge" ? (
                <KnowledgePanel />
            ) : activeTab === "skills" ? (
                <SkillsPanel
                    skills={skills}
                    onDeleteSkill={handleDeleteSkill}
                    onToggleSkill={handleToggleSkill}
                />
            ) : activeTab === "files" ? (
                <FileBrowserPanel />
            ) : activeTab === "mcp" ? (
                <McpPanel
                    serverStates={serverStates}
                    onAddServer={addServer}
                    onRemoveServer={removeServer}
                    onToggleServer={toggleServer}
                    onToggleTool={toggleTool}
                    onReconnectServer={reconnectServer}
                />
            ) : (
                <>
                    <MessageList messages={messages} />
                    <ChatInputBar input={input} onInputChange={setInput} onSend={handleSend} isLoading={isLoading} disabled={!apiKey} contextUsage={contextUsage} />
                </>
            )}
        </div>
    )
}
