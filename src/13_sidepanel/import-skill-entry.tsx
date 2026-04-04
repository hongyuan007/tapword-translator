import { createRoot } from "react-dom/client"
import { useState, useRef } from "react"
import { Upload, X, CheckCircle, AlertCircle, Loader2, FolderOpen } from "lucide-react"
import "./styles/sidepanel.css"
import * as loggerModule from "@/0_common/utils/logger"
import * as i18nModule from "@/0_common/utils/i18n"
import * as skillStorageService from "./services/SkillStorageService"

// --- Constants ---

const logger = loggerModule.createLogger("ImportSkillPage")

/** Max individual file size (512 KB). Files larger than this are skipped. */
const MAX_FILE_SIZE = 512 * 1024
/** Max number of files allowed per skill folder. */
const MAX_FILE_COUNT = 50
/** File extensions considered text-importable. */
const TEXT_EXTENSIONS = new Set([
    ".md", ".txt", ".ts", ".tsx", ".js", ".jsx", ".json", ".yaml", ".yml",
    ".html", ".css", ".scss", ".xml", ".svg", ".toml", ".ini", ".cfg",
    ".sh", ".bash", ".zsh", ".py", ".rb", ".go", ".rs", ".java", ".swift",
    ".kt", ".c", ".cpp", ".h", ".hpp", ".cs", ".sql", ".graphql", ".vue",
    ".astro", ".mdx", ".env", ".gitignore", ".editorconfig", ".prettierrc",
])

/** Auto-close delay after successful import (ms). */
const AUTO_CLOSE_DELAY = 1500

// Initialize i18n locale detection
i18nModule.initI18n()

/** Helper to replace `{placeholder}` tokens in a translated template. */
function t(key: string, params?: Record<string, string | number>): string {
    let text = i18nModule.translate(key)
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, String(v))
        }
    }
    return text
}

// --- Helpers ---

type ImportRejectionReason = "hidden" | "too_large" | "unsupported_extension"

function getImportRejectionReason(file: File): ImportRejectionReason | null {
    const parts = file.webkitRelativePath.split("/")
    if (parts.some((part) => part.startsWith("."))) return "hidden"
    if (file.size > MAX_FILE_SIZE) return "too_large"
    const fileName = file.name.toLowerCase()
    const lastDot = fileName.lastIndexOf(".")
    if (lastDot === -1) return null
    const ext = fileName.slice(lastDot)
    return TEXT_EXTENSIONS.has(ext) ? null : "unsupported_extension"
}

// --- Status types ---

type ImportStatus =
    | { kind: "idle" }
    | { kind: "importing"; message: string }
    | { kind: "success"; skillName: string }
    | { kind: "error"; message: string }

// --- Component ---

function ImportSkillPage() {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [status, setStatus] = useState<ImportStatus>({ kind: "idle" })

    async function handleFolderSelect(event: React.ChangeEvent<HTMLInputElement>) {
        const fileList = event.target.files
        if (!fileList || fileList.length === 0) return

        try {
            setStatus({ kind: "importing", message: t("sidepanel.importPopup.readingFiles") })

            // Extract folder name
            const firstPath = fileList[0]!.webkitRelativePath
            if (!firstPath.includes("/")) {
                throw new Error(`Unexpected folder import path: '${firstPath || "(empty)"}'`)
            }
            const folderName = firstPath.split("/")[0]!
            logger.info(`Starting folder import for '${folderName}' with ${fileList.length} selected files`)

            // Filter eligible files
            const skippedByReason: Record<ImportRejectionReason, number> = {
                hidden: 0,
                too_large: 0,
                unsupported_extension: 0,
            }
            let eligible = Array.from(fileList).filter((file) => {
                const rejectionReason = getImportRejectionReason(file)
                if (rejectionReason) {
                    skippedByReason[rejectionReason] += 1
                    return false
                }
                return true
            })

            logger.info(
                `Filtered to ${eligible.length} files ` +
                `(hidden=${skippedByReason.hidden}, tooLarge=${skippedByReason.too_large}, unsupported=${skippedByReason.unsupported_extension})`
            )

            if (eligible.length === 0) {
                throw new Error(t("sidepanel.importPopup.noImportableFiles"))
            }

            if (eligible.length > MAX_FILE_COUNT) {
                logger.warn(`Folder contains ${eligible.length} files, truncating to ${MAX_FILE_COUNT}`)
                eligible = eligible.slice(0, MAX_FILE_COUNT)
            }

            setStatus({ kind: "importing", message: t("sidepanel.importPopup.readingNFiles", { count: eligible.length }) })

            // Read filtered files
            const files: Array<{ relativePath: string; content: string }> = []
            for (const file of eligible) {
                const relativePath = file.webkitRelativePath.split("/").slice(1).join("/")
                if (!relativePath) continue
                const content = await file.text()
                files.push({ relativePath, content })
            }

            setStatus({ kind: "importing", message: t("sidepanel.importPopup.importingToStorage") })

            // Import via shared OPFS
            const skillMeta = await skillStorageService.importSkill(folderName, files)
            logger.info(`Skill '${skillMeta.id}' imported successfully`)

            // Notify sidepanel
            chrome.runtime.sendMessage({ type: "skill-imported", skillMeta }).catch((err) => {
                logger.warn("Failed to send skill-imported message", err)
            })

            setStatus({ kind: "success", skillName: skillMeta.name })

            // Auto-close after delay
            setTimeout(() => window.close(), AUTO_CLOSE_DELAY)
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error occurred"
            logger.error("Failed to import skill folder", error)
            setStatus({ kind: "error", message })
        } finally {
            event.target.value = ""
        }
    }

    const isImporting = status.kind === "importing"

    return (
        <div className="flex flex-col h-screen bg-stone-50 text-stone-800 p-5 select-none">
            {/* Header */}
            <h1 className="text-sm font-semibold text-stone-700 mb-1">{t("sidepanel.importPopup.title")}</h1>
            <p className="text-xs text-stone-400 mb-5">
                {t("sidepanel.importPopup.subtitle")}
            </p>

            {/* Folder picker */}
            <button
                className="flex items-center justify-center gap-2 w-full py-3 rounded-lg border-2 border-dashed border-stone-300 hover:border-stone-400 bg-white hover:bg-stone-50 text-stone-500 hover:text-stone-700 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting || status.kind === "success"}
            >
                <FolderOpen className="w-4 h-4" />
                {t("sidepanel.importPopup.chooseFolder")}
            </button>
            <input
                ref={fileInputRef}
                type="file"
                webkitdirectory=""
                className="hidden"
                onChange={handleFolderSelect}
            />

            {/* Status area */}
            <div className="flex-1 flex items-center justify-center">
                {status.kind === "idle" && (
                    <div className="flex flex-col items-center gap-2 text-stone-300">
                        <Upload className="w-6 h-6" />
                        <span className="text-xs">{t("sidepanel.importPopup.noFolderSelected")}</span>
                    </div>
                )}

                {status.kind === "importing" && (
                    <div className="flex flex-col items-center gap-2 text-stone-500">
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-xs">{status.message}</span>
                    </div>
                )}

                {status.kind === "success" && (
                    <div className="flex flex-col items-center gap-2 text-green-600">
                        <CheckCircle className="w-6 h-6" />
                        <span className="text-xs font-medium">{t("sidepanel.importPopup.importedSkill", { name: status.skillName })}</span>
                        <span className="text-[10px] text-stone-400">{t("sidepanel.importPopup.closingAutomatically")}</span>
                    </div>
                )}

                {status.kind === "error" && (
                    <div className="flex flex-col items-center gap-2 text-red-500 max-w-[320px] text-center">
                        <AlertCircle className="w-6 h-6" />
                        <span className="text-xs">{status.message}</span>
                    </div>
                )}
            </div>

            {/* Cancel / Close button */}
            <button
                className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-stone-200 hover:bg-stone-300 text-stone-600 text-xs font-medium transition-colors"
                onClick={() => window.close()}
            >
                <X className="w-3.5 h-3.5" />
                {status.kind === "success" ? t("sidepanel.importPopup.close") : t("sidepanel.importPopup.cancel")}
            </button>
        </div>
    )
}

// --- Mount ---

const container = document.getElementById("root")!
createRoot(container).render(<ImportSkillPage />)
