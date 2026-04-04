import { useState, useEffect, useCallback } from "react"
import { Folder, FolderOpen, FileText, ChevronRight, ChevronDown, Loader2, HardDrive, X } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import * as loggerModule from "@/0_common/utils/logger"
import { tapWordFS, VFS_PATH_PREFIX } from "../services/TapWordFS"
import type { DirEntry, FileStat } from "../services/TapWordFS"

const logger = loggerModule.createLogger("FileBrowserPanel")

// --- Constants ---

const ROOT_PATH = VFS_PATH_PREFIX
const MAX_DEPTH = 5
const BYTES_PER_KB = 1024
const INDENT_PX_PER_LEVEL = 16
/** Max file size for preview (200 KB). */
const MAX_PREVIEW_SIZE = 200 * 1024

// --- Types ---

interface TreeNode {
    name: string
    path: string
    kind: "file" | "directory"
    depth: number
    /** Only for files */
    stat?: FileStat
    /** Only for directories */
    childCount?: number
    isExpanded?: boolean
    isLoading?: boolean
    children?: TreeNode[]
}

// --- Helpers ---

/** Format bytes into human-readable size. */
function formatSize(bytes: number): string {
    if (bytes < BYTES_PER_KB) return `${bytes} B`
    const kb = bytes / BYTES_PER_KB
    if (kb < BYTES_PER_KB) return `${kb.toFixed(1)} KB`
    const mb = kb / BYTES_PER_KB
    return `${mb.toFixed(1)} MB`
}

/** Format timestamp to short date string. */
function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

/** Sort entries: directories first, then files, alphabetically within each group. */
function sortEntries(entries: DirEntry[]): DirEntry[] {
    return [...entries].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1
        return a.name.localeCompare(b.name)
    })
}

// --- Preview Types ---

type PreviewState =
    | { kind: "idle" }
    | { kind: "loading"; fileName: string }
    | { kind: "loaded"; fileName: string; filePath: string; content: string; size: number }
    | { kind: "error"; fileName: string; message: string }

// --- Component ---

export function FileBrowserPanel() {
    const [rootNodes, setRootNodes] = useState<TreeNode[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [preview, setPreview] = useState<PreviewState>({ kind: "idle" })

    /** Load entries for a directory path and return TreeNode[] */
    const loadDir = useCallback(async (dirPath: string, depth: number): Promise<TreeNode[]> => {
        const entries = await tapWordFS.listDir(dirPath)
        const sorted = sortEntries(entries)

        const nodes: TreeNode[] = await Promise.all(
            sorted.map(async (entry) => {
                const entryPath = dirPath + entry.name + (entry.kind === "directory" ? "/" : "")
                const node: TreeNode = {
                    name: entry.name,
                    path: entryPath,
                    kind: entry.kind,
                    depth,
                }

                if (entry.kind === "file") {
                    try {
                        node.stat = await tapWordFS.stat(entryPath)
                    } catch {
                        // stat failed — leave undefined
                    }
                } else {
                    // Pre-fetch child count for directories
                    try {
                        const children = await tapWordFS.listDir(entryPath)
                        node.childCount = children.length
                    } catch {
                        node.childCount = 0
                    }
                }
                return node
            })
        )
        return nodes
    }, [])

    /** Initial load */
    useEffect(() => {
        let cancelled = false
        async function init() {
            try {
                const nodes = await loadDir(ROOT_PATH, 0)
                if (!cancelled) setRootNodes(nodes)
            } catch (err) {
                logger.error("Failed to load root directory", err)
            } finally {
                if (!cancelled) setIsLoading(false)
            }
        }
        init()
        return () => { cancelled = true }
    }, [loadDir])

    /** Toggle expand/collapse for a directory node. */
    const toggleDir = useCallback(async (targetPath: string) => {
        /** Recursively find and update the target node in the tree. */
        function updateNode(nodes: TreeNode[], updater: (node: TreeNode) => TreeNode): TreeNode[] {
            return nodes.map((node) => {
                if (node.path === targetPath && node.kind === "directory") {
                    return updater(node)
                }
                if (node.children) {
                    return { ...node, children: updateNode(node.children, updater) }
                }
                return node
            })
        }

        // Check if the node is currently expanded (read from current state)
        let isCurrentlyExpanded = false
        setRootNodes((prev) => {
            // Find the target node to check its state
            function findExpanded(nodes: TreeNode[]): boolean {
                for (const n of nodes) {
                    if (n.path === targetPath) return !!n.isExpanded
                    if (n.children) { const found = findExpanded(n.children); if (found) return true }
                }
                return false
            }
            isCurrentlyExpanded = findExpanded(prev)
            return prev // No-op update, just reading
        })

        if (isCurrentlyExpanded) {
            // Collapse: synchronous state update
            setRootNodes((prev) => updateNode(prev, (node) => ({
                ...node, isExpanded: false, children: undefined,
            })))
        } else {
            // Expand: mark loading → load children → update
            setRootNodes((prev) => updateNode(prev, (node) => ({
                ...node, isLoading: true,
            })))

            // Find the depth of the target node
            let targetDepth = 0
            setRootNodes((prev) => {
                function findDepth(nodes: TreeNode[]): number {
                    for (const n of nodes) {
                        if (n.path === targetPath) return n.depth
                        if (n.children) { const d = findDepth(n.children); if (d >= 0) return d }
                    }
                    return -1
                }
                targetDepth = findDepth(prev)
                return prev
            })

            if (targetDepth >= MAX_DEPTH) {
                setRootNodes((prev) => updateNode(prev, (node) => ({
                    ...node, isLoading: false,
                })))
                return
            }

            try {
                const children = await loadDir(targetPath, targetDepth + 1)
                setRootNodes((prev) => updateNode(prev, (node) => ({
                    ...node,
                    isExpanded: true,
                    isLoading: false,
                    children,
                    childCount: children.length,
                })))
            } catch (err) {
                logger.error(`Failed to load directory: ${targetPath}`, err)
                setRootNodes((prev) => updateNode(prev, (node) => ({
                    ...node, isLoading: false,
                })))
            }
        }
    }, [loadDir])

    /** Open file preview. */
    const openPreview = useCallback(async (node: TreeNode) => {
        if (node.stat && node.stat.size > MAX_PREVIEW_SIZE) {
            setPreview({ kind: "error", fileName: node.name, message: `File too large to preview (${formatSize(node.stat.size)})` })
            return
        }
        setPreview({ kind: "loading", fileName: node.name })
        try {
            const content = await tapWordFS.readFile(node.path)
            setPreview({ kind: "loaded", fileName: node.name, filePath: node.path, content, size: content.length })
        } catch (err) {
            logger.error(`Failed to read file: ${node.path}`, err)
            setPreview({ kind: "error", fileName: node.name, message: "Failed to read file" })
        }
    }, [])

    const closePreview = useCallback(() => setPreview({ kind: "idle" }), [])

    // --- Render helpers ---

    function renderNode(node: TreeNode): React.ReactNode {
        const indent = node.depth * INDENT_PX_PER_LEVEL
        const isDir = node.kind === "directory"

        return (
            <div key={node.path}>
                <button
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-stone-100 transition-colors rounded-md cursor-pointer ${
                        !isDir && preview.kind !== "idle" && "filePath" in preview && preview.filePath === node.path
                            ? "bg-stone-100"
                            : ""
                    }`}
                    style={{ paddingLeft: `${indent + 12}px` }}
                    onClick={isDir ? () => toggleDir(node.path) : () => openPreview(node)}
                >
                    {/* Expand/collapse chevron for directories */}
                    {isDir ? (
                        node.isLoading ? (
                            <Loader2 className="w-3 h-3 text-stone-400 animate-spin flex-shrink-0" />
                        ) : node.isExpanded ? (
                            <ChevronDown className="w-3 h-3 text-stone-400 flex-shrink-0" />
                        ) : (
                            <ChevronRight className="w-3 h-3 text-stone-400 flex-shrink-0" />
                        )
                    ) : (
                        <span className="w-3 flex-shrink-0" />
                    )}

                    {/* Icon */}
                    {isDir ? (
                        node.isExpanded ? (
                            <FolderOpen className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        ) : (
                            <Folder className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        )
                    ) : (
                        <FileText className="w-4 h-4 text-stone-400 flex-shrink-0" />
                    )}

                    {/* Name and metadata */}
                    <div className="flex-1 min-w-0 flex items-baseline justify-between gap-2">
                        <span className="text-xs text-stone-700 truncate">{node.name}</span>
                        {isDir ? (
                            <span className="text-[10px] text-stone-400 flex-shrink-0 whitespace-nowrap">
                                {node.childCount ?? 0} {i18nModule.translate("sidepanel.files.items")}
                            </span>
                        ) : node.stat ? (
                            <span className="text-[10px] text-stone-400 flex-shrink-0 whitespace-nowrap">
                                {formatSize(node.stat.size)} · {formatDate(node.stat.lastModified)}
                            </span>
                        ) : null}
                    </div>
                </button>

                {/* Render children if expanded */}
                {node.isExpanded && node.children && node.children.map(renderNode)}
            </div>
        )
    }

    // --- Preview panel ---
    function renderPreview() {
        if (preview.kind === "idle") return null

        return (
            <div className="border-t border-stone-200 flex flex-col max-h-[60%] min-h-[120px]">
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-2 bg-stone-50 border-b border-stone-200">
                    <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-3.5 h-3.5 text-stone-400 flex-shrink-0" />
                        <span className="text-xs font-medium text-stone-700 truncate">{preview.fileName}</span>
                        {preview.kind === "loaded" && (
                            <span className="text-[10px] text-stone-400 flex-shrink-0">{formatSize(preview.size)}</span>
                        )}
                    </div>
                    <button
                        className="p-0.5 rounded hover:bg-stone-200 transition-colors"
                        onClick={closePreview}
                    >
                        <X className="w-3.5 h-3.5 text-stone-400" />
                    </button>
                </div>
                {/* Content */}
                <div className="flex-1 overflow-auto">
                    {preview.kind === "loading" && (
                        <div className="flex items-center justify-center py-8">
                            <Loader2 className="w-4 h-4 text-stone-400 animate-spin" />
                        </div>
                    )}
                    {preview.kind === "error" && (
                        <div className="px-3 py-4 text-xs text-stone-400 text-center">{preview.message}</div>
                    )}
                    {preview.kind === "loaded" && (
                        <pre className="px-3 py-2 text-[11px] leading-relaxed text-stone-600 font-mono whitespace-pre-wrap break-words">{preview.content}</pre>
                    )}
                </div>
            </div>
        )
    }

    // --- Loading state ---
    if (isLoading) {
        return (
            <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-stone-400 animate-spin" />
            </div>
        )
    }

    // --- Empty state ---
    if (rootNodes.length === 0) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center">
                <HardDrive className="w-8 h-8 text-stone-300" />
                <p className="text-xs text-stone-400 max-w-[200px]">{i18nModule.translate("sidepanel.files.emptyState")}</p>
            </div>
        )
    }

    // --- Tree view with optional preview ---
    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
                <div className="py-2">{rootNodes.map(renderNode)}</div>
            </div>
            {renderPreview()}
        </div>
    )
}
