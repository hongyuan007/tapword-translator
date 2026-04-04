import { useRef, useEffect } from "react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { ChatMessage } from "../types"
import { MessageBubble } from "./MessageBubble"

interface MessageListProps {
    messages: ChatMessage[]
}

export function MessageList({ messages }: MessageListProps) {
    const messagesEndRef = useRef<HTMLDivElement>(null)

    // Auto-scroll to bottom on new messages
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    return (
        <main className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && <p className="text-xs text-stone-400 text-center mt-8">{i18nModule.translate("sidepanel.emptyState")}</p>}
            {messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} />
            ))}

            <div ref={messagesEndRef} />
        </main>
    )
}
