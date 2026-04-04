import { Bot, User, AlertTriangle } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { ChatMessage } from "../types"

interface MessageBubbleProps {
    message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user"
    const isError = message.isError

    return (
        <div className={`flex gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
            {!isUser && (
                <div
                    className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${isError ? "bg-red-950" : "bg-gray-800"}`}
                >
                    {isError ? <AlertTriangle className="w-3.5 h-3.5 text-red-400" /> : <Bot className="w-3.5 h-3.5 text-blue-400" />}
                </div>
            )}
            <div className={`max-w-[80%] space-y-1`}>
                {/* Tool call badges */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                        {message.toolCalls.map((tool, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-gray-800 text-gray-400">
                                {tool}
                            </span>
                        ))}
                    </div>
                )}
                {/* Message content */}
                <div
                    className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        isError
                            ? "bg-red-950/50 text-red-300 rounded-bl-md border border-red-900/50"
                            : isUser
                              ? "bg-blue-600 text-white rounded-br-md"
                              : "bg-gray-800 text-gray-100 rounded-bl-md"
                    }`}
                >
                    {message.content || <span className="text-gray-500 italic text-xs">{i18nModule.translate("sidepanel.thinking")}</span>}
                </div>
            </div>
            {isUser && (
                <div className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center mt-0.5">
                    <User className="w-3.5 h-3.5 text-white" />
                </div>
            )}
        </div>
    )
}
