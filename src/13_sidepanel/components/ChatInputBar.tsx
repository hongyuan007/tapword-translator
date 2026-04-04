import { Send, Loader2 } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"

interface ChatInputBarProps {
    input: string
    onInputChange: (value: string) => void
    onSend: () => void
    isLoading: boolean
    disabled: boolean
}

export function ChatInputBar({ input, onInputChange, onSend, isLoading, disabled }: ChatInputBarProps) {
    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            onSend()
        }
    }

    return (
        <footer className="px-3 py-2 border-t border-gray-800">
            <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
                <input
                    className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-500 outline-none"
                    placeholder={
                        disabled ? i18nModule.translate("sidepanel.input.placeholderDisabled") : i18nModule.translate("sidepanel.input.placeholder")
                    }
                    value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading || disabled}
                />
                <button
                    className="p-1 rounded-md text-blue-400 hover:text-blue-300 disabled:text-gray-600 disabled:cursor-not-allowed"
                    onClick={onSend}
                    disabled={isLoading || !input.trim() || disabled}
                >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
            </div>
        </footer>
    )
}
