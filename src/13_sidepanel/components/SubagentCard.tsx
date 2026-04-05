import { useState, useEffect, memo } from "react"
import { Loader2, Check, X, Bot } from "lucide-react"
import type { SubagentBlock, ContentBlock } from "../types"
import { ThinkingCard } from "./ThinkingCard"
import { ToolCallCard } from "./ToolCallCard"
import { MarkdownBlock } from "./MarkdownBlock"

interface SubagentCardProps {
    block: SubagentBlock
}

/** Check if a nested block should be rendered. */
function isVisibleNestedBlock(block: ContentBlock): boolean {
    if (block.type === "tool_call") return true
    if ("content" in block) return block.content !== "" || ("isStreaming" in block && block.isStreaming)
    return true
}

/** Render a single nested content block from the subagent. */
function renderNestedBlock(block: ContentBlock, index: number) {
    switch (block.type) {
        case "thinking":
            return <ThinkingCard key={index} thinkingContent={block.content} isThinking={block.isStreaming} />
        case "text":
            return (
                <div key={index} className="rounded-lg px-2.5 py-1.5 text-xs bg-stone-50 text-stone-700 break-words">
                    {block.content ? (
                        <MarkdownBlock content={block.content} isStreaming={block.isStreaming} />
                    ) : (
                        block.isStreaming && <span className="text-stone-400 italic text-[10px]">…</span>
                    )}
                </div>
            )
        case "tool_call":
            return <ToolCallCard key={index} block={block} />
        default:
            return null
    }
}

export const SubagentCard = memo(function SubagentCard({ block }: SubagentCardProps) {
    const [isExpanded, setIsExpanded] = useState(true)

    // Auto-collapse when subagent completes
    useEffect(() => {
        if (block.status !== "running") {
            setIsExpanded(false)
        }
    }, [block.status])

    const isRunning = block.status === "running"
    const isError = block.status === "error"

    return (
        <div
            className={`rounded-lg border text-xs transition-all duration-300 ${
                isRunning
                    ? "border-l-2 border-l-purple-400 border-stone-200"
                    : isError
                      ? "border-l-2 border-l-red-400 border-stone-200"
                      : "border-l-2 border-l-green-400 border-stone-200"
            }`}
        >
            {/* Header */}
            <div
                className="flex items-center gap-1.5 px-2.5 py-1.5 select-none cursor-pointer"
                onClick={() => setIsExpanded((prev) => !prev)}
            >
                <Bot className="w-3 h-3 text-purple-500" />
                <span className="text-stone-600 font-medium truncate">{block.description}</span>
                <span className="ml-auto flex items-center gap-1">
                    {isRunning && <Loader2 className="w-3 h-3 text-purple-500 animate-spin" />}
                    {block.status === "completed" && <Check className="w-3 h-3 text-green-600" />}
                    {isError && <X className="w-3 h-3 text-red-500" />}
                    {block.rounds != null && (
                        <span className="text-stone-400 text-[10px]">
                            {block.rounds}r · {block.toolCallCount ?? 0}t
                        </span>
                    )}
                    <span className="text-stone-400 text-[10px]">{isExpanded ? "▾" : "▸"}</span>
                </span>
            </div>

            {/* Nested content blocks */}
            {isExpanded && block.nestedBlocks.length > 0 && (
                <div className="px-2.5 pb-2 space-y-1 border-t border-stone-100">
                    {block.nestedBlocks.filter(isVisibleNestedBlock).map((nb, i) => renderNestedBlock(nb, i))}
                </div>
            )}
        </div>
    )
})
