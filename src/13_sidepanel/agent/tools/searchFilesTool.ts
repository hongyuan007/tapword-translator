import * as loggerModule from "@/0_common/utils/logger"
import { tapWordFS, VFS_PATH_PREFIX } from "../../services/TapWordFS"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("searchFilesTool")
const DEFAULT_MAX_RESULTS = 20
const MAX_RESULTS_CAP = 100
const MAX_FILE_SIZE_BYTES = 500 * 1024 // 500KB

interface SearchMatch {
    filePath: string
    lineNumber: number
    lineText: string
}

/** Recursively list all file paths under a directory. */
async function listFilesRecursive(dirPath: string): Promise<string[]> {
    const entries = await tapWordFS.listDir(dirPath)
    const files: string[] = []
    for (const entry of entries) {
        const fullPath = dirPath.endsWith("/") ? dirPath + entry.name : dirPath + "/" + entry.name
        if (entry.kind === "file") {
            files.push(fullPath)
        } else {
            const subFiles = await listFilesRecursive(fullPath)
            files.push(...subFiles)
        }
    }
    return files
}

/** Test a line against a query (plain text or regex). Returns true if match found. */
function testLine(line: string, query: string, isRegexp: boolean, regex: RegExp | null): boolean {
    if (isRegexp && regex) {
        return regex.test(line)
    }
    return line.toLowerCase().includes(query.toLowerCase())
}

// ─── search_files ──────────────────────────────────────────────

export const searchFilesTool: ToolRegistration = {
    definition: {
        name: "search_files",
        description:
            "Search for text patterns across files in the TapWord virtual filesystem. " +
            "Returns matching lines with file paths and line numbers. " +
            "Useful for finding specific content, function names, or patterns across skill files.",
        input_schema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "The text or regex pattern to search for. Case-insensitive by default.",
                },
                path: {
                    type: "string",
                    description:
                        "Directory to search within (default: '/tapword/'). " +
                        "Must start with '/tapword/'.",
                },
                is_regexp: {
                    type: "boolean",
                    description: "If true, treat query as a regular expression. Default: false (plain text search).",
                },
                max_results: {
                    type: "number",
                    description: "Maximum number of matching lines to return (default: 20, max: 100).",
                },
            },
            required: ["query"],
        },
    },
    label: "Searching files...",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const query = input.query as string
        const path = (input.path as string) ?? VFS_PATH_PREFIX
        const isRegexp = (input.is_regexp as boolean) ?? false
        const maxResults = Math.min((input.max_results as number) ?? DEFAULT_MAX_RESULTS, MAX_RESULTS_CAP)

        if (!query) {
            return "Error: query is required."
        }

        if (!path.startsWith(VFS_PATH_PREFIX)) {
            return `Error: Invalid path '${path}'. Path must start with '${VFS_PATH_PREFIX}'.`
        }

        // Compile regex if needed
        let regex: RegExp | null = null
        if (isRegexp) {
            try {
                regex = new RegExp(query, "i")
            } catch (err) {
                return `Error: Invalid regex pattern '${query}': ${err instanceof Error ? err.message : String(err)}`
            }
        }

        try {
            const allFiles = await listFilesRecursive(path)
            const matches: SearchMatch[] = []
            let filesSearched = 0

            for (const filePath of allFiles) {
                if (matches.length >= maxResults) break

                // Skip large files
                try {
                    const stat = await tapWordFS.stat(filePath)
                    if (stat.size > MAX_FILE_SIZE_BYTES) {
                        logger.warn(`Skipping large file (${stat.size} bytes): ${filePath}`)
                        continue
                    }
                } catch {
                    // stat failed — try reading anyway
                }

                try {
                    const content = await tapWordFS.readFile(filePath)
                    filesSearched++
                    const lines = content.split("\n")

                    for (let i = 0; i < lines.length; i++) {
                        if (matches.length >= maxResults) break
                        if (testLine(lines[i]!, query, isRegexp, regex)) {
                            matches.push({
                                filePath,
                                lineNumber: i + 1,
                                lineText: lines[i]!.trimEnd(),
                            })
                        }
                    }
                } catch {
                    // Skip files that can't be read
                    logger.warn(`Failed to read file: ${filePath}`)
                }
            }

            if (matches.length === 0) {
                return `No matches found for "${query}" in ${path}. ${filesSearched} files searched.`
            }

            // Group matches by file
            const grouped = new Map<string, SearchMatch[]>()
            for (const match of matches) {
                const existing = grouped.get(match.filePath)
                if (existing) {
                    existing.push(match)
                } else {
                    grouped.set(match.filePath, [match])
                }
            }

            // Format output
            const parts: string[] = [`Found ${matches.length} matches for "${query}" in ${path}:\n`]
            for (const [file, fileMatches] of grouped) {
                parts.push(`── ${file} ──`)
                for (const m of fileMatches) {
                    parts.push(`  L${m.lineNumber}: ${m.lineText}`)
                }
                parts.push("")
            }
            parts.push(`${matches.length} matches (${filesSearched} files searched)`)

            logger.info(`Search for "${query}": ${matches.length} matches in ${filesSearched} files`)
            return parts.join("\n")
        } catch (err) {
            logger.error(`Search failed for "${query}" in ${path}:`, err)
            return `Error: Search failed: ${err instanceof Error ? err.message : String(err)}`
        }
    },
}

// Self-register with the global tool registry
import { toolRegistry } from "./ToolRegistry"
toolRegistry.add(searchFilesTool)
