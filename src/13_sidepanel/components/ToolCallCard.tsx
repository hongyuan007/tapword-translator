import { useState } from "react"
import { Wrench, Loader2, Check, X } from "lucide-react"
import type { ToolCallBlock } from "../types"

/** Max chars to show in collapsed result preview. */
const RESULT_PREVIEW_LENGTH = 200

interface ToolCallCardProps {
    block: ToolCallBlock
}

export function ToolCallCard({ block }: ToolCallCardProps) {
    const [isExpanded, setIsExpanded] = useState(false)
    const [showFullText, setShowFullText] = useState(false)

    const hasDetail = block.status !== "running" && !!block.result
    const displayText = block.result ?? ""
    const isTruncated = displayText.length > RESULT_PREVIEW_LENGTH
    const previewText = isTruncated && !showFullText ? displayText.slice(0, RESULT_PREVIEW_LENGTH) + "…" : displayText

    return (
        <div
            className={`rounded-lg border text-xs transition-all duration-300 ${
                block.status === "running"
                    ? "border-l-2 border-l-blue-400 border-stone-200 animate-pulse"
                    : block.status === "error"
                      ? "border-l-2 border-l-red-400 border-stone-200"
                      : "border-stone-200"
            }`}
        >
            {/* Header */}
            <div
                className={`flex items-center gap-1.5 px-2.5 py-1.5 select-none ${hasDetail ? "cursor-pointer" : ""}`}
                onClick={() => {
                    if (!hasDetail) return
                    setIsExpanded((prev) => !prev)
                    if (isExpanded) setShowFullText(false)
                }}
            >
                <Wrench className="w-3 h-3 text-stone-400" />
                <span className="text-stone-600 font-medium truncate">{block.toolLabel}</span>
                <span className="ml-auto flex items-center gap-1">
                    {block.status === "running" && <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />}
                    {block.status === "completed" && <Check className="w-3 h-3 text-green-600" />}
                    {block.status === "error" && <X className="w-3 h-3 text-red-500" />}
                    {hasDetail && <span className="text-stone-400 text-[10px]">{isExpanded ? "▾" : "▸"}</span>}
                </span>
            </div>

            {/* Collapsible result / error */}
            {hasDetail && isExpanded && (
                <div className="px-2.5 pb-2">
                    <div
                        className={`text-[11px] whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto ${
                            block.isError ? "text-red-600" : "text-stone-500"
                        }`}
                    >
                        {previewText}
                    </div>
                    {isTruncated && !showFullText && (
                        <button
                            className="mt-1 text-[10px] text-blue-500 hover:underline"
                            onClick={(e) => {
                                e.stopPropagation()
                                setShowFullText(true)
                            }}
                        >
                            Show more
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}
