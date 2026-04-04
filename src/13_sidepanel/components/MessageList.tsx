import { useRef, useEffect } from "react"
import { Loader2 } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { ChatMessage } from "../types"
import { MessageBubble } from "./MessageBubble"

interface MessageListProps {
    messages: ChatMessage[]
    activeTool: string | null
}

export function MessageList({ messages, activeTool }: MessageListProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Auto-scroll to bottom on new messages or tool activity
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages, activeTool])

    return (
        <main className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && <p className="text-xs text-gray-500 text-center mt-8">{i18nModule.translate("sidepanel.emptyState")}</p>}
            {messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} />
            ))}

            {/* Active tool indicator */}
            {activeTool && (
                <div className="flex items-center gap-2 px-3 py-1.5">
                    <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                    <span className="text-xs text-blue-400">{activeTool}</span>
                </div>
            )}

            <div ref={messagesEndRef} />
        </main>
    )
}
