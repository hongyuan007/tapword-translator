import { AlertTriangle } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { ChatMessage, ContentBlock } from "../types"
import { ThinkingCard } from "./ThinkingCard"
import { ToolCallCard } from "./ToolCallCard"

const BOT_AVATAR_URL = chrome.runtime.getURL("assets/pic/bot_avator.jpg")
const USER_AVATAR_URL = chrome.runtime.getURL("assets/pic/user_avator.png")

interface MessageBubbleProps {
    message: ChatMessage
}

/** Check if a block should be rendered (filter out empty non-streaming blocks). */
function isVisibleBlock(block: ContentBlock): boolean {
    if (block.type === "tool_call") return true
    return block.content !== "" || block.isStreaming
}

export function MessageBubble({ message }: MessageBubbleProps) {
    const isUser = message.role === "user"
    const isError = message.isError
    const hasBlocks = message.blocks && message.blocks.length > 0

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
                {isUser ? (
                    /* User message — single text bubble */
                    <div className="rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words bg-blue-500 text-white rounded-br-md">
                        {message.content}
                    </div>
                ) : hasBlocks ? (
                    /* Block-based assistant rendering */
                    <>
                        {message.blocks!.filter(isVisibleBlock).map((block, i) => renderBlock(block, i, isError))}
                        {/* Show placeholder when no visible blocks and no content yet */}
                        {message.blocks!.filter(isVisibleBlock).length === 0 && !message.content && (
                            <div className="rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words bg-white text-stone-800 rounded-bl-md border border-stone-200">
                                <span className="text-stone-400 italic text-xs">{i18nModule.translate("sidepanel.thinking")}</span>
                            </div>
                        )}
                    </>
                ) : (
                    /* Fallback: assistant message without blocks — render content as plain text */
                    <div
                        className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                            isError
                                ? "bg-red-50 text-red-800 rounded-bl-md border border-red-200"
                                : "bg-white text-stone-800 rounded-bl-md border border-stone-200"
                        }`}
                    >
                        {message.content}
                    </div>
                )}
            </div>
            {isUser && (
                <div className="flex-shrink-0 mt-0.5">
                    <img src={USER_AVATAR_URL} alt="User" className="w-8 h-8 rounded-lg object-cover" />
                </div>
            )}
        </div>
    )
}

function renderBlock(block: ContentBlock, index: number, isError?: boolean) {
    switch (block.type) {
        case "thinking":
            return <ThinkingCard key={index} thinkingContent={block.content} isThinking={block.isStreaming} />
        case "text":
            return (
                <div
                    key={index}
                    className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                        isError
                            ? "bg-red-50 text-red-800 rounded-bl-md border border-red-200"
                            : "bg-white text-stone-800 rounded-bl-md border border-stone-200"
                    }`}
                >
                    {block.content || (block.isStreaming && <span className="text-stone-400 italic text-xs">…</span>)}
                </div>
            )
        case "tool_call":
            return <ToolCallCard key={index} block={block} />
        default:
            return null
    }
}
