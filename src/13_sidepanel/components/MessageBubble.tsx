import { AlertTriangle } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { ChatMessage } from "../types"

const BOT_AVATAR_URL = chrome.runtime.getURL("assets/pic/bot_avator.jpg")
const USER_AVATAR_URL = chrome.runtime.getURL("assets/pic/user_avator.png")

interface MessageBubbleProps {
    message: ChatMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user"
    const isError = message.isError

    return (
        <div className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"}`}>
            {!isUser && (
                <div className="flex-shrink-0 mt-0.5">
                    {isError ? (
                        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                            <AlertTriangle className="w-4 h-4 text-red-500" />
                        </div>
                    ) : (
                        <img src={BOT_AVATAR_URL} alt="Bot" className="w-8 h-8 rounded-lg object-cover" />
                    )}
                </div>
            )}
            <div className={`max-w-[80%] space-y-1`}>
                {/* Tool call badges */}
                {message.toolCalls && message.toolCalls.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1">
                        {message.toolCalls.map((tool, i) => (
                            <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-stone-100 text-stone-500">
                                {tool}
                            </span>
                        ))}
                    </div>
                )}
                {/* Message content */}
                <div
                    className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        isError
                            ? "bg-red-50 text-red-800 rounded-bl-md border border-red-200"
                            : isUser
                              ? "bg-blue-500 text-white rounded-br-md"
                              : "bg-white text-stone-800 rounded-bl-md border border-stone-200"
                    }`}
                >
                    {message.content || <span className="text-stone-400 italic text-xs">{i18nModule.translate("sidepanel.thinking")}</span>}
                </div>
            </div>
            {isUser && (
                <div className="flex-shrink-0 mt-0.5">
                    <img src={USER_AVATAR_URL} alt="User" className="w-8 h-8 rounded-lg object-cover" />
                </div>
            )}
        </div>
    )
}
