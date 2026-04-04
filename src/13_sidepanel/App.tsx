import { useState, useRef } from "react"
import { Loader2 } from "lucide-react"
import { KnowledgeStore } from "./store/KnowledgeStore"
import { useApiKey } from "./hooks/useApiKey"
import { useAgentChat } from "./hooks/useAgentChat"
import { ChatHeader } from "./components/ChatHeader"
import { MessageList } from "./components/MessageList"
import { ChatInputBar } from "./components/ChatInputBar"
import { SettingsDrawer } from "./components/SettingsDrawer"
import { AuthBanner } from "./components/AuthBanner"
import { ApiKeySetup } from "./components/ApiKeySetup"
import { KnowledgePanel } from "./components/KnowledgePanel"

// --- Component ---

export default function App() {
    const [activeTab, setActiveTab] = useState<"chat" | "knowledge">("chat")
    const [showSettings, setShowSettings] = useState(false)
    const [input, setInput] = useState("")
    const knowledgeStoreRef = useRef(new KnowledgeStore())

    const { apiKey, isLoaded: keyLoaded, apiKeyInput, setApiKeyInput, saveKey } = useApiKey()
    const { messages, isLoading, activeTool, showAuthError, sendMessage, clearChat, dismissAuthError } = useAgentChat(
        apiKey,
        knowledgeStoreRef.current
    )

    async function handleSend() {
        const trimmed = input.trim()
        if (!trimmed) return
        setInput("")
        await sendMessage(trimmed)
    }

    async function handleSaveKey() {
        await saveKey()
        setShowSettings(false)
    }

    // Wait for key loading before rendering
    if (!keyLoaded) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-950">
                <Loader2 className="w-5 h-5 text-gray-500 animate-spin" />
            </div>
        )
    }

    // API key setup screen
    if (!apiKey) {
        return <ApiKeySetup apiKeyInput={apiKeyInput} onApiKeyInputChange={setApiKeyInput} onSave={handleSaveKey} />
    }

    return (
        <div className="flex flex-col h-screen bg-gray-950 text-gray-100">
            <ChatHeader
                activeTab={activeTab}
                onTabChange={setActiveTab}
                onClearChat={clearChat}
                onToggleSettings={() => setShowSettings(!showSettings)}
                showClearButton={activeTab === "chat"}
            />
            {showSettings && (
                <SettingsDrawer
                    apiKeyInput={apiKeyInput}
                    onApiKeyInputChange={setApiKeyInput}
                    onSave={handleSaveKey}
                    onClose={() => setShowSettings(false)}
                    currentKeyPreview={apiKey}
                />
            )}
            {showAuthError && (
                <AuthBanner
                    onOpenSettings={() => {
                        setShowSettings(true)
                        dismissAuthError()
                    }}
                />
            )}
            {activeTab === "knowledge" ? (
                <KnowledgePanel knowledgeStore={knowledgeStoreRef.current} />
            ) : (
                <>
                    <MessageList messages={messages} activeTool={activeTool} />
                    <ChatInputBar input={input} onInputChange={setInput} onSend={handleSend} isLoading={isLoading} disabled={!apiKey} />
                </>
            )}
        </div>
    )
}
