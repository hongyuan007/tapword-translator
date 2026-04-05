import { useState } from "react"
import { Loader2 } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { CompactionBlock } from "../types"

interface CompactionCardProps {
    block: CompactionBlock
}

export function CompactionCard({ block }: CompactionCardProps) {
    const [isExpanded, setIsExpanded] = useState(false)

    const isCompressing = block.status === "compressing"
    const savedTokensK = Math.round((block.tokensBefore - block.tokensAfter) / 1000)

    if (isCompressing) {
        return (
            <div className="rounded-lg border border-stone-200 border-l-2 border-l-amber-400 text-xs">
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 select-none">
                    <Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
                    <span className="text-stone-500 font-medium">
                        {i18nModule.translate("sidepanel.compaction.compressing")}
                    </span>
                    <span className="text-stone-400">·</span>
                    <span className="text-stone-400">
                        {block.compressedMessageCount} {i18nModule.translate("sidepanel.compaction.messages")}
                    </span>
                </div>
            </div>
        )
    }

    return (
        <div
            className="rounded-lg border border-stone-200 border-l-2 border-l-amber-400 text-xs cursor-pointer transition-all duration-300"
            onClick={() => setIsExpanded((prev) => !prev)}
        >
            {/* Header */}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 select-none">
                <span>📦</span>
                <span className="text-stone-500 font-medium">
                    {i18nModule.translate("sidepanel.compaction.title")}
                </span>
                <span className="text-stone-400">·</span>
                <span className="text-stone-400">
                    {block.compressedMessageCount} {i18nModule.translate("sidepanel.compaction.messages")} → {i18nModule.translate("sidepanel.compaction.summary")}
                </span>
                <span className="text-stone-400">·</span>
                <span className="text-stone-400">
                    {i18nModule.translate("sidepanel.compaction.saved")} ~{savedTokensK}K tokens
                </span>
                <span className="ml-auto text-stone-400 text-[10px]">{isExpanded ? "▾" : "▸"}</span>
            </div>

            {/* Collapsible content */}
            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isExpanded ? "max-h-[300px]" : "max-h-0"}`}>
                <div className="px-2.5 pb-2 text-stone-500 whitespace-pre-wrap break-words overflow-y-auto max-h-[280px]">
                    {block.summary}
                </div>
            </div>
        </div>
    )
}
