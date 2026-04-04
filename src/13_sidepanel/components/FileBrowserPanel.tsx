import { useState, useEffect, useCallback } from "react"
import { Folder, FolderOpen, FileText, ChevronRight, ChevronDown, Loader2, HardDrive } from "lucide-react"
import * as i18nModule from "@/0_common/utils/i18n"
import * as loggerModule from "@/0_common/utils/logger"
import { tapWordFS } from "../services/TapWordFS"
import type { DirEntry, FileStat } from "../services/TapWordFS"

const logger = loggerModule.createLogger("FileBrowserPanel")

// --- Constants ---

const ROOT_PATH = "/tapword/"
const MAX_DEPTH = 5
const BYTES_PER_KB = 1024
const INDENT_PX_PER_LEVEL = 16

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

// --- Component ---

export function FileBrowserPanel() {
    const [rootNodes, setRootNodes] = useState<TreeNode[]>([])
    const [isLoading, setIsLoading] = useState(true)

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
        /** Recursively update a node list to toggle the target directory. */
        async function updateNodes(nodes: TreeNode[]): Promise<TreeNode[]> {
            const result: TreeNode[] = []
            for (const node of nodes) {
                if (node.path === targetPath && node.kind === "directory") {
                    if (node.isExpanded) {
                        // Collapse
                        result.push({ ...node, isExpanded: false, children: undefined })
                    } else {
                        // Guard max depth
                        if (node.depth >= MAX_DEPTH) {
                            result.push(node)
                            continue
                        }
                        // Mark loading
                        result.push({ ...node, isLoading: true })
                    }
                } else if (node.children) {
                    result.push({ ...node, children: await updateNodes(node.children) })
                } else {
                    result.push(node)
                }
            }
            return result
        }

        // First pass: set loading state
        setRootNodes((prev) => {
            // We run this async, so update state optimistically
            updateNodes(prev).then(setRootNodes)
            return prev
        })

        // Actually load children for the target
        /** Find and expand the target node within the tree. */
        async function expandTarget(nodes: TreeNode[]): Promise<TreeNode[]> {
            const result: TreeNode[] = []
            for (const node of nodes) {
                if (node.path === targetPath && node.kind === "directory" && !node.isExpanded) {
                    try {
                        const children = await loadDir(node.path, node.depth + 1)
                        result.push({
                            ...node,
                            isExpanded: true,
                            isLoading: false,
                            children,
                            childCount: children.length,
                        })
                    } catch (err) {
                        logger.error(`Failed to load directory: ${node.path}`, err)
                        result.push({ ...node, isLoading: false })
                    }
                } else if (node.children) {
                    result.push({ ...node, children: await expandTarget(node.children) })
                } else {
                    result.push(node)
                }
            }
            return result
        }

        setRootNodes((prev) => {
            expandTarget(prev).then(setRootNodes)
            return prev
        })
    }, [loadDir])

    // --- Render helpers ---

    function renderNode(node: TreeNode): React.ReactNode {
        const indent = node.depth * INDENT_PX_PER_LEVEL
        const isDir = node.kind === "directory"

        return (
            <div key={node.path}>
                <button
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-stone-100 transition-colors rounded-md ${
                        isDir ? "cursor-pointer" : "cursor-default"
                    }`}
                    style={{ paddingLeft: `${indent + 12}px` }}
                    onClick={isDir ? () => toggleDir(node.path) : undefined}
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

    // --- Tree view ---
    return (
        <div className="flex-1 overflow-y-auto">
            <div className="py-2">{rootNodes.map(renderNode)}</div>
        </div>
    )
}
