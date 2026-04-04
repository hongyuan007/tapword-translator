import { MessageSquare, BookOpen, Trash2, Settings } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"

interface ChatHeaderProps {
    activeTab: "chat" | "knowledge"
    onTabChange: (tab: "chat" | "knowledge") => void
    onClearChat: () => void
    onToggleSettings: () => void
    showClearButton: boolean
}

export function ChatHeader({ activeTab, onTabChange, onClearChat, onToggleSettings, showClearButton }: ChatHeaderProps) {
    return (
        <header className="flex items-center justify-between px-4 py-3 bg-white border-b border-stone-200">
            <div className="flex items-center gap-1">
                <button
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        activeTab === "chat" ? "text-stone-900 border-b-2 border-stone-900" : "text-stone-400 hover:text-stone-600"
                    }`}
                    onClick={() => onTabChange("chat")}
                >
                    <MessageSquare className="w-3.5 h-3.5" />
                    {i18nModule.translate("sidepanel.tab.chat")}
                </button>
                <button
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                        activeTab === "knowledge" ? "text-stone-900 border-b-2 border-stone-900" : "text-stone-400 hover:text-stone-600"
                    }`}
                    onClick={() => onTabChange("knowledge")}
                >
                    <BookOpen className="w-3.5 h-3.5" />
                    {i18nModule.translate("sidepanel.tab.knowledge")}
                </button>
            </div>
            <div className="flex items-center gap-1">
                {showClearButton && (
                    <button
                        className="p-1.5 rounded-md hover:bg-stone-100 text-stone-400 hover:text-stone-600"
                        onClick={onClearChat}
                        title={i18nModule.translate("sidepanel.clearChat")}
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                )}
                <button
                    className="p-1.5 rounded-md hover:bg-stone-100 text-stone-400 hover:text-stone-600"
                    onClick={onToggleSettings}
                    title={i18nModule.translate("sidepanel.settings")}
                >
                    <Settings className="w-4 h-4" />
                </button>
            </div>
        </header>
    )
}
