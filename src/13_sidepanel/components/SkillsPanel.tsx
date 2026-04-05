import { useState } from "react"
import { Download, Trash2, ChevronDown, ChevronUp, Zap, Loader2 } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import { skillStorageService } from "@/13_sidepanel/services/SkillStorageService"
import type { SkillMeta } from "../types"

// --- Constants ---

const PREVIEW_MAX_HEIGHT = 256

/** Popup window dimensions for the import-skill relay page. */
const IMPORT_POPUP_WIDTH = 420
const IMPORT_POPUP_HEIGHT = 380

// --- Props ---

interface SkillsPanelProps {
    skills: SkillMeta[]
    onDeleteSkill: (skillId: string) => void
    onToggleSkill: (skillId: string, enabled: boolean) => void
}

// --- Component ---

export function SkillsPanel({ skills, onDeleteSkill, onToggleSkill }: SkillsPanelProps) {
    const [expandedId, setExpandedId] = useState<string | null>(null)
    const [bodyCache, setBodyCache] = useState<Record<string, string>>({})
    const [loadingBodyId, setLoadingBodyId] = useState<string | null>(null)

    function handleOpenImportWindow() {
        chrome.windows.create({
            url: chrome.runtime.getURL("src/13_sidepanel/import-skill.html"),
            type: "popup",
            width: IMPORT_POPUP_WIDTH,
            height: IMPORT_POPUP_HEIGHT,
        })
    }

    async function handleTogglePreview(skillId: string) {
        if (expandedId === skillId) {
            setExpandedId(null)
            return
        }

        setExpandedId(skillId)

        // Load body on demand if not cached
        if (!bodyCache[skillId]) {
            setLoadingBodyId(skillId)
            const body = await skillStorageService.getSkillBody(skillId)
            setBodyCache((prev) => ({ ...prev, [skillId]: body ?? "(empty)" }))
            setLoadingBodyId(null)
        }
    }

    // --- Empty state ---
    if (skills.length === 0) {
        return (
            <div className="flex-1 flex flex-col">
                {/* Import button at top */}
                <div className="p-3 border-b border-stone-200">
                    <button
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors"
                        onClick={handleOpenImportWindow}
                    >
                        <Download className="w-3.5 h-3.5" />
                        {i18nModule.translate("sidepanel.skills.import")}
                    </button>
                </div>

                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                    <Zap className="w-8 h-8 text-stone-300" />
                    <p className="text-xs text-stone-400 max-w-[200px]">{i18nModule.translate("sidepanel.skills.emptyState")}</p>
                </div>
            </div>
        )
    }

    // --- Skill list ---
    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Import button */}
            <div className="p-3 border-b border-stone-200">
                <button
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors"
                    onClick={handleOpenImportWindow}
                >
                    <Download className="w-3.5 h-3.5" />
                    {i18nModule.translate("sidepanel.skills.import")}
                </button>
            </div>

            {/* Skills list */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {skills.map((skill) => (
                    <div key={skill.id} className="group bg-white rounded-lg border border-stone-200 hover:border-stone-300 transition-colors">
                        <div className="px-3 pt-3 pb-2 space-y-1.5">
                            {/* Row 1: Name + Delete */}
                            <div className="flex items-center justify-between gap-2">
                                <span className={`text-xs font-medium truncate ${skill.enabled ? "text-stone-800" : "text-stone-400"}`}>
                                    {skill.name}
                                </span>
                                <button
                                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-stone-100 text-stone-400 hover:text-red-500 shrink-0 transition-opacity"
                                    onClick={() => onDeleteSkill(skill.id)}
                                    title={i18nModule.translate("sidepanel.knowledge.delete")}
                                >
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>

                            {/* Row 2: Description */}
                            <p className={`text-[11px] leading-snug line-clamp-2 ${skill.enabled ? "text-stone-500" : "text-stone-400"}`}>
                                {skill.description}
                            </p>

                            {/* Row 3: File count badge + Toggle switch */}
                            <div className="flex items-center justify-between gap-2 pt-0.5">
                                <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
                                    <span>📁</span>
                                    <span>{skill.files.length} {skill.files.length === 1 ? "file" : "files"}</span>
                                </span>

                                <button
                                    role="switch"
                                    aria-checked={skill.enabled}
                                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                                        skill.enabled ? "bg-blue-500" : "bg-stone-300"
                                    }`}
                                    onClick={() => onToggleSkill(skill.id, !skill.enabled)}
                                    title={skill.enabled ? i18nModule.translate("sidepanel.skills.enabled") : i18nModule.translate("sidepanel.skills.disabled")}
                                >
                                    <span
                                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                            skill.enabled ? "translate-x-4" : "translate-x-0"
                                        }`}
                                    />
                                </button>
                            </div>

                            {/* Row 4: Preview toggle */}
                            <button
                                className="flex items-center gap-0.5 text-[10px] text-stone-400 hover:text-stone-600 transition-colors"
                                onClick={() => handleTogglePreview(skill.id)}
                            >
                                {expandedId === skill.id ? (
                                    <ChevronUp className="w-3 h-3" />
                                ) : (
                                    <ChevronDown className="w-3 h-3" />
                                )}
                                {i18nModule.translate("sidepanel.skills.preview")}
                            </button>
                        </div>

                        {/* Preview body */}
                        {expandedId === skill.id && (
                            <div className="border-t border-stone-100 px-3 py-2">
                                {loadingBodyId === skill.id ? (
                                    <div className="flex items-center justify-center py-3">
                                        <Loader2 className="w-4 h-4 text-stone-400 animate-spin" />
                                    </div>
                                ) : (
                                    <pre
                                        className="text-[11px] text-stone-600 whitespace-pre-wrap break-words overflow-y-auto font-mono leading-relaxed"
                                        style={{ maxHeight: PREVIEW_MAX_HEIGHT }}
                                    >
                                        {bodyCache[skill.id]}
                                    </pre>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
