import { useRef, useEffect, useCallback } from "react"
import { Send, Loader2 } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"

const MIN_TEXTAREA_HEIGHT = 36
const MAX_TEXTAREA_ROWS = 4
const LINE_HEIGHT = 20
const TEXTAREA_PADDING = 16
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * MAX_TEXTAREA_ROWS + TEXTAREA_PADDING

interface ChatInputBarProps {
    input: string
    onInputChange: (value: string) => void
    onSend: () => void
    isLoading: boolean
    disabled: boolean
}

export function ChatInputBar({ input, onInputChange, onSend, isLoading, disabled }: ChatInputBarProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    const adjustHeight = useCallback(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.style.height = "auto"
        textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
    }, [])

    useEffect(() => {
        adjustHeight()
    }, [input, adjustHeight])

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === "Enter" && (e.shiftKey || e.metaKey)) {
            e.preventDefault()
            onSend()
        }
    }

    return (
        <footer className="px-3 py-2 bg-white border-t border-stone-200">
            <div className="flex items-end gap-2 bg-stone-100 rounded-lg px-3 py-2">
                <textarea
                    ref={textareaRef}
                    className="flex-1 bg-transparent text-sm text-stone-800 placeholder-stone-400 outline-none resize-none leading-5"
                    style={{
                        minHeight: `${MIN_TEXTAREA_HEIGHT}px`,
                        maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
                    }}
                    rows={1}
                    placeholder={
                        disabled ? i18nModule.translate("sidepanel.input.placeholderDisabled") : i18nModule.translate("sidepanel.input.placeholder")
                    }
                    value={input}
                    onChange={(e) => onInputChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading || disabled}
                />
                <button
                    className="p-1 rounded-md text-blue-500 hover:text-blue-400 disabled:text-stone-300 disabled:cursor-not-allowed"
                    onClick={onSend}
                    disabled={isLoading || !input.trim() || disabled}
                >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
            </div>
        </footer>
    )
}
