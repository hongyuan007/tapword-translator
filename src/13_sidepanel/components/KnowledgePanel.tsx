import { useState, useEffect, useCallback } from "react"
import { Trash2, Loader2, Database } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { KnowledgeStore, KnowledgeItem } from "../store/KnowledgeStore"

// --- Constants ---

const TEXT_SNIPPET_LENGTH = 100
const URL_DISPLAY_LENGTH = 40

const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const DAYS_PER_MONTH = 30

// --- Helpers ---

function formatRelativeTime(timestamp: number): string {
    const diff = Date.now() - timestamp
    const seconds = Math.floor(diff / 1000)
    const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
    const hours = Math.floor(minutes / MINUTES_PER_HOUR)
    const days = Math.floor(hours / HOURS_PER_DAY)

    if (seconds < SECONDS_PER_MINUTE) return i18nModule.translate("sidepanel.time.justNow")
    if (minutes < MINUTES_PER_HOUR) return `${minutes}${i18nModule.translate("sidepanel.time.minutesAgo")}`
    if (hours < HOURS_PER_DAY) return `${hours}${i18nModule.translate("sidepanel.time.hoursAgo")}`
    if (days === 1) return i18nModule.translate("sidepanel.time.yesterday")
    if (days < DAYS_PER_MONTH) return `${days}${i18nModule.translate("sidepanel.time.daysAgo")}`
    return new Date(timestamp).toLocaleDateString()
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + "..."
}

// --- Component ---

interface KnowledgePanelProps {
    knowledgeStore: KnowledgeStore
}

export function KnowledgePanel({ knowledgeStore }: KnowledgePanelProps) {
    const [items, setItems] = useState<KnowledgeItem[]>([])
    const [isLoading, setIsLoading] = useState(true)

    const loadItems = useCallback(async () => {
        try {
            const allItems = await knowledgeStore.list()
            allItems.sort((a, b) => b.createdAt - a.createdAt)
            setItems(allItems)
        } catch {
            // Failed to load items
        } finally {
            setIsLoading(false)
        }
    }, [knowledgeStore])

    useEffect(() => {
        loadItems()
    }, [loadItems])

    async function handleDelete(id: string) {
        try {
            await knowledgeStore.delete(id)
            setItems((prev) => prev.filter((item) => item.id !== id))
        } catch {
            // Failed to delete
        }
    }

    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
            </div>
        )
    }

    if (items.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Database className="w-8 h-8 text-stone-300" />
                <p className="text-xs text-stone-400 max-w-[200px]">{i18nModule.translate("sidepanel.knowledge.emptyState")}</p>
            </div>
        )
    }

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="p-3 space-y-2">
                {items.map((item) => (
                    <div key={item.id} className="bg-white rounded-lg p-3 border border-stone-200 hover:border-stone-300 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                            <h3 className="text-sm font-medium text-stone-800 truncate flex-1">{item.title}</h3>
                            <button
                                className="p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-red-500 flex-shrink-0"
                                onClick={() => handleDelete(item.id)}
                                title={i18nModule.translate("sidepanel.knowledge.delete")}
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                            </button>
                        </div>
                        {item.source && <p className="text-[10px] text-stone-400 mt-1 truncate">{truncate(item.source, URL_DISPLAY_LENGTH)}</p>}
                        <p className="text-xs text-stone-500 mt-1.5 line-clamp-2">{truncate(item.text, TEXT_SNIPPET_LENGTH)}</p>
                        <p className="text-[10px] text-stone-400 mt-1.5">{formatRelativeTime(item.createdAt)}</p>
                    </div>
                ))}
            </div>
        </div>
    )
}
