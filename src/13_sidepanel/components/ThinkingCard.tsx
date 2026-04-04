import { useState, useEffect } from "react"

interface ThinkingCardProps {
    thinkingContent: string
    isThinking: boolean
}

export function ThinkingCard({ thinkingContent, isThinking }: ThinkingCardProps) {
    const [isExpanded, setIsExpanded] = useState(isThinking)

    // Auto-sync expanded state to isThinking: expand when thinking starts, collapse when done
    useEffect(() => {
        setIsExpanded(isThinking)
    }, [isThinking])

    return (
        <div
            className={`rounded-lg border text-xs cursor-pointer transition-all duration-300 ${isThinking ? "border-l-2 border-l-blue-400 border-stone-200 animate-pulse" : "border-stone-200"}`}
            onClick={() => setIsExpanded((prev) => !prev)}
        >
            {/* Header */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 select-none">
                <span>💭</span>
                <span className="text-stone-500 font-medium">{isThinking ? "Thinking..." : "Thinking"}</span>
                <span className="ml-auto text-stone-400 text-[10px]">{isExpanded ? "▾" : "▸"}</span>
            </div>

            {/* Collapsible content */}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? "max-h-[200px]" : "max-h-0"}`}>
                <div className="px-2.5 pb-2 text-stone-500 whitespace-pre-wrap break-words overflow-y-auto max-h-[180px]">{thinkingContent}</div>
            </div>
        </div>
    )
}
