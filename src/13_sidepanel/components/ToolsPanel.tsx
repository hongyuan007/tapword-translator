import { useState, useEffect } from "react"
import { Wrench, Zap, BookOpen } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import { toolRegistry } from "@/13_sidepanel/agent/tools/ToolRegistry"
import type { ToolRegistration } from "@/13_sidepanel/agent/tools/types"
import type { ToolCategory } from "@/13_sidepanel/agent/tools/types"

// --- Builtin sub-group definitions ---

interface BuiltinSubGroup {
    label: string
    toolNames: string[]
}

const BUILTIN_SUB_GROUPS: BuiltinSubGroup[] = [
    {
        label: "网页工具",
        toolNames: ["get_current_page", "get_selected_text", "fetch_url"],
    },
    {
        label: "文件工具",
        toolNames: ["read_file", "list_directory", "write_file", "delete_file", "delete_directory", "search_files"],
    },
    {
        label: "知识工具",
        toolNames: ["search_knowledge", "store_knowledge"],
    },
    {
        label: "任务工具",
        toolNames: ["create_todos", "update_todo_status", "complete_task"],
    },
]

// --- Toggle switch (matches McpPanel style) ---

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            role="switch"
            aria-checked={checked}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                checked ? "bg-blue-500" : "bg-stone-300"
            }`}
            onClick={() => onChange(!checked)}
        >
            <span
                className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    checked ? "translate-x-3" : "translate-x-0"
                }`}
            />
        </button>
    )
}

// --- Tool row ---

function ToolRow({ name, tool, enabled, onToggle }: { name: string; tool: ToolRegistration; enabled: boolean; onToggle: (v: boolean) => void }) {
    const locale = i18nModule.getCurrentLocale()
    const isChinese = locale === "zh"
    const displayDescription = isChinese
        ? (tool.descriptionCN || tool.definition.description)
        : tool.definition.description

    return (
        <div className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-white border border-stone-100">
            <div className="min-w-0 flex-1">
                <code className={`text-[11px] font-mono ${enabled ? "text-stone-800" : "text-stone-400"}`}>{name}</code>
                <p className={`text-[11px] leading-snug mt-0.5 ${enabled ? "text-stone-600" : "text-stone-400"}`}>{displayDescription}</p>
            </div>
            <div className="pt-1 shrink-0">
                <ToggleSwitch checked={enabled} onChange={onToggle} />
            </div>
        </div>
    )
}

// --- Main panel ---

export function ToolsPanel() {
    const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})

    // Sync state from registry on mount
    useEffect(() => {
        const allTools = toolRegistry.getAll()
        const initial: Record<string, boolean> = {}
        for (const [name] of allTools) {
            initial[name] = toolRegistry.isEnabled(name)
        }
        setEnabledMap(initial)
    }, [])

    function handleToggle(name: string, enabled: boolean) {
        if (enabled) {
            toolRegistry.enable(name)
        } else {
            toolRegistry.disable(name)
        }
        setEnabledMap((prev) => ({ ...prev, [name]: enabled }))
    }

    const allTools = toolRegistry.getAll()

    // Group tools by category field
    const builtinTools: [string, ToolRegistration][] = []
    const capabilityTools: [string, ToolRegistration][] = []
    const skillTools: [string, ToolRegistration][] = []
    for (const [name, tool] of allTools) {
        const cat: ToolCategory = tool.category ?? "builtin"
        if (cat === "capability") {
            capabilityTools.push([name, tool])
        } else if (cat === "skill") {
            skillTools.push([name, tool])
        } else {
            builtinTools.push([name, tool])
        }
    }

    // Collect builtin tools that don't belong to any sub-group
    const subGroupNames = new Set(BUILTIN_SUB_GROUPS.flatMap((g) => g.toolNames))
    const uncategorizedBuiltin = builtinTools.filter(([name]) => !subGroupNames.has(name))

    // Empty state
    if (allTools.size === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <Wrench className="w-8 h-8 text-stone-300" />
                <p className="text-xs text-stone-400">{i18nModule.translate("sidepanel.tools.emptyState")}</p>
            </div>
        )
    }

    const enabledCount = Object.values(enabledMap).filter(Boolean).length
    const totalCount = allTools.size

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Summary bar */}
            <div className="px-3 py-2 border-b border-stone-200 flex items-center gap-2">
                <Wrench className="w-3.5 h-3.5 text-stone-400" />
                <span className="text-[11px] text-stone-500">
                    {enabledCount}/{totalCount} {i18nModule.translate("sidepanel.tools.enabledCount")}
                </span>
            </div>

            {/* Tool list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-5">
                {/* Section: Builtin Tools */}
                {builtinTools.length > 0 && (
                    <div>
                        <div className="flex items-center gap-1.5 mb-2 px-1">
                            <Wrench className="w-3.5 h-3.5 text-stone-500" />
                            <h2 className="text-xs font-bold text-stone-700">工具</h2>
                        </div>
                        <div className="space-y-3">
                            {BUILTIN_SUB_GROUPS.map((group) => {
                                const tools = group.toolNames
                                    .map((n) => [n, allTools.get(n)] as const)
                                    .filter((pair): pair is [string, ToolRegistration] => pair[1] !== undefined)
                                if (tools.length === 0) return null
                                return (
                                    <div key={group.label}>
                                        <h3 className="text-[11px] font-semibold text-stone-500 mb-1.5 px-1">{group.label}</h3>
                                        <div className="space-y-1.5">
                                            {tools.map(([name, tool]) => (
                                                <ToolRow
                                                    key={name}
                                                    name={name}
                                                    tool={tool}
                                                    enabled={enabledMap[name] ?? true}
                                                    onToggle={(v) => handleToggle(name, v)}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )
                            })}
                            {/* Builtin tools not in any sub-group */}
                            {uncategorizedBuiltin.length > 0 && (
                                <div>
                                    <h3 className="text-[11px] font-semibold text-stone-500 mb-1.5 px-1">{i18nModule.translate("sidepanel.tools.otherCategory")}</h3>
                                    <div className="space-y-1.5">
                                        {uncategorizedBuiltin.map(([name, tool]) => (
                                            <ToolRow
                                                key={name}
                                                name={name}
                                                tool={tool}
                                                enabled={enabledMap[name] ?? true}
                                                onToggle={(v) => handleToggle(name, v)}
                                            />
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Section: Advanced Capabilities */}
                {capabilityTools.length > 0 && (
                    <div>
                        <div className="flex items-center gap-1.5 mb-2 px-1">
                            <Zap className="w-3.5 h-3.5 text-amber-500" />
                            <h2 className="text-xs font-bold text-amber-700">高级能力</h2>
                        </div>
                        <div className="space-y-1.5">
                            {capabilityTools.map(([name, tool]) => (
                                <ToolRow
                                    key={name}
                                    name={name}
                                    tool={tool}
                                    enabled={enabledMap[name] ?? true}
                                    onToggle={(v) => handleToggle(name, v)}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Section: Skills */}
                {skillTools.length > 0 && (
                    <div>
                        <div className="flex items-center gap-1.5 mb-2 px-1">
                            <BookOpen className="w-3.5 h-3.5 text-violet-500" />
                            <h2 className="text-xs font-bold text-violet-700">技能</h2>
                        </div>
                        <div className="space-y-1.5">
                            {skillTools.map(([name, tool]) => (
                                <ToolRow
                                    key={name}
                                    name={name}
                                    tool={tool}
                                    enabled={enabledMap[name] ?? true}
                                    onToggle={(v) => handleToggle(name, v)}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
