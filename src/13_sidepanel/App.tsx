import { useState } from "react"
import { Loader2 } from "lucide-react"
import { useApiKey } from "./hooks/useApiKey"
import { useAgentChat } from "./hooks/useAgentChat"
import { ChatHeader } from "./components/ChatHeader"
import { MessageList } from "./components/MessageList"
import { ChatInputBar } from "./components/ChatInputBar"
import { SettingsDrawer } from "./components/SettingsDrawer"
import { AuthBanner } from "./components/AuthBanner"
import { ApiKeySetup } from "./components/ApiKeySetup"
import { KnowledgePanel } from "./components/KnowledgePanel"
import { TodoPanel } from "./components/TodoPanel"

// --- Component ---

export default function App() {
    const [activeTab, setActiveTab] = useState<"chat" | "knowledge">("chat")
    const [showSettings, setShowSettings] = useState(false)
    const [input, setInput] = useState("")

    const { apiKey, isLoaded: keyLoaded, apiKeyInput, setApiKeyInput, saveKey } = useApiKey()
    const { messages, isLoading, showAuthError, todoItems, isTaskCompleted, sendMessage, clearChat, dismissAuthError } = useAgentChat(apiKey)

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
            <div className="flex items-center justify-center h-screen bg-stone-50">
                <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
            </div>
        )
    }

    // API key setup screen
    if (!apiKey) {
        return <ApiKeySetup apiKeyInput={apiKeyInput} onApiKeyInputChange={setApiKeyInput} onSave={handleSaveKey} />
    }

    return (
        <div className="flex flex-col h-screen bg-stone-50 text-stone-800">
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
            {todoItems.length > 0 && <TodoPanel items={todoItems} isTaskCompleted={isTaskCompleted} />}
            {activeTab === "knowledge" ? (
                <KnowledgePanel />
            ) : (
                <>
                    <MessageList messages={messages} />
                    <ChatInputBar input={input} onInputChange={setInput} onSend={handleSend} isLoading={isLoading} disabled={!apiKey} />
                </>
            )}
        </div>
    )
}
