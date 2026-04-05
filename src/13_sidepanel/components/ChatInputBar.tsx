import { useRef, useEffect, useCallback } from "react"
import { Send, Square } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import { ContextUsageIndicator } from "./ContextUsageBar"
import type { ContextUsage } from "../types"

const MIN_TEXTAREA_HEIGHT = 36
const MAX_TEXTAREA_ROWS = 4
const LINE_HEIGHT = 20
const TEXTAREA_PADDING = 16
const MAX_TEXTAREA_HEIGHT = LINE_HEIGHT * MAX_TEXTAREA_ROWS + TEXTAREA_PADDING

interface ChatInputBarProps {
    input: string
    onInputChange: (value: string) => void
    onSend: () => void
    onAbort?: () => void
    isLoading: boolean
    disabled: boolean
    contextUsage?: ContextUsage | null
}

export function ChatInputBar({ input, onInputChange, onSend, onAbort, isLoading, disabled, contextUsage }: ChatInputBarProps) {
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
        <footer className="bg-white border-t border-stone-200">
            <div className="flex flex-col gap-1 bg-stone-100 rounded-lg mx-3 my-2 px-3 py-2">
                <div className="flex items-end gap-2">
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
                        <Send className="w-4 h-4" />
                    </button>
                    {isLoading && (
                        <button
                            className="p-1 rounded-md text-red-500 hover:text-red-400"
                            onClick={onAbort}
                            title="Stop generation"
                        >
                            <Square className="w-4 h-4 fill-current" />
                        </button>
                    )}
                </div>
                <ContextUsageIndicator usage={contextUsage ?? null} />
            </div>
        </footer>
    )
}
