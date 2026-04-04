import { useState, useEffect } from "react"
import { Circle, CheckCircle2, Loader2, ChevronDown, ChevronRight } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import type { TodoItem } from "../types"

interface TodoPanelProps {
    items: readonly TodoItem[]
    isTaskCompleted: boolean
}

function StatusIcon({ status }: { status: TodoItem["status"] }) {
    switch (status) {
        case "pending":
            return <Circle className="w-3.5 h-3.5 text-stone-400 shrink-0" />
        case "in_progress":
            return <Loader2 className="w-3.5 h-3.5 text-blue-500 animate-spin shrink-0" />
        case "completed":
            return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
    }
}

function TodoItemRow({ item }: { item: TodoItem }) {
    const textClass =
        item.status === "completed" ? "line-through text-stone-400" : item.status === "in_progress" ? "font-medium text-blue-500" : "text-stone-500"

    return (
        <div className="flex items-start gap-2 py-1 px-1">
            <StatusIcon status={item.status} />
            <span className={`text-xs leading-relaxed ${textClass}`}>{item.title}</span>
        </div>
    )
}

export function TodoPanel({ items, isTaskCompleted }: TodoPanelProps) {
    const [collapsed, setCollapsed] = useState(false)

    // Auto-collapse when task is completed
    useEffect(() => {
        if (isTaskCompleted) {
            setCollapsed(true)
        }
    }, [isTaskCompleted])

    if (items.length === 0) return null

    const completed = items.filter((i) => i.status === "completed").length
    const total = items.length
    const headerLabel = i18nModule.translate("sidepanel.todo.header")
    const progressText = `${completed}/${total}`
    const collapseLabel = collapsed ? i18nModule.translate("sidepanel.todo.expand") : i18nModule.translate("sidepanel.todo.collapse")

    return (
        <div className="border-b border-stone-200 bg-stone-50">
            {isTaskCompleted && (
                <div className="px-4 py-1.5 bg-emerald-50 border-b border-emerald-200 text-xs text-emerald-700 font-medium flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    {i18nModule.translate("sidepanel.todo.completed")}
                </div>
            )}
            <button
                className="flex items-center justify-between w-full px-4 py-2 text-xs text-stone-600 hover:bg-stone-100 transition-colors"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapseLabel}
                title={collapseLabel}
            >
                <div className="flex items-center gap-1.5">
                    {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    <span className="font-medium">
                        {headerLabel} ({progressText})
                    </span>
                </div>
            </button>
            {!collapsed && (
                <div className="px-4 pb-2 space-y-0.5">
                    {items.map((item) => (
                        <TodoItemRow key={item.id} item={item} />
                    ))}
                </div>
            )}
        </div>
    )
}
