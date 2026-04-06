import * as loggerModule from "@/0_common/utils/logger"
import { tapWordFS, VFS_PATH_PREFIX, VFS_ROOT } from "../../services/TapWordFS"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("fileTools")

/** Validate that a path is non-empty and starts with /tapword/. Returns error message or null if valid. */
function validatePath(path: string): string | null {
    if (!path) return "path is required"
    if (!path.startsWith(VFS_PATH_PREFIX)) {
        return `Invalid path '${path}'. Path must start with '${VFS_PATH_PREFIX}'.`
    }
    return null
}

// ─── list_directory ────────────────────────────────────────────

export const listDirectoryTool: ToolRegistration = {
    definition: {
        name: "list_directory",
        description:
            "List files and subdirectories at a given path in the TapWord virtual filesystem. " +
            "The path must be an absolute virtual FS path starting with /tapword/.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Absolute directory path (e.g., '/tapword/skills/')",
                },
            },
            required: ["path"],
        },
    },
    label: "Listing directory...",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const path = input.path as string
        const error = validatePath(path)
        if (error) return `Error: ${error}`

        try {
            const entries = await tapWordFS.listDir(path)
            if (entries.length === 0) {
                return `Directory '${path}' is empty.`
            }

            const lines = entries.map((e) => (e.kind === "directory" ? `${e.name}/` : e.name))
            logger.info(`Listed ${entries.length} entries in '${path}'`)
            return `Directory: ${path}\n\n${lines.join("\n")}\n\n${entries.length} entries`
        } catch (err) {
            logger.error(`Failed to list directory '${path}'`, err)
            return `Error: Failed to list directory '${path}': ${err instanceof Error ? err.message : String(err)}`
        }
    },
}

// ─── write_file ────────────────────────────────────────────────

export const writeFileTool: ToolRegistration = {
    definition: {
        name: "write_file",
        description:
            "Create a new file or overwrite an existing file in the TapWord virtual filesystem. " +
            "Parent directories are created automatically. " +
            "The path must be an absolute virtual FS path starting with /tapword/.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Absolute file path (e.g., '/tapword/skills/my-skill/SKILL.md')",
                },
                content: {
                    type: "string",
                    description: "The text content to write to the file",
                },
            },
            required: ["path", "content"],
        },
    },
    label: "Writing file...",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const path = input.path as string
        const content = (input.content as string) ?? ""
        const error = validatePath(path)
        if (error) return `Error: ${error}`

        if (path.endsWith("/")) {
            return `Error: Invalid path '${path}'. Path should point to a file, not a directory.`
        }

        try {
            await tapWordFS.writeFile(path, content)
            logger.info(`Wrote ${content.length} chars to '${path}'`)
            return `Successfully wrote ${content.length} chars to ${path}`
        } catch (err) {
            logger.error(`Failed to write to '${path}'`, err)
            return `Error: Failed to write to ${path}: ${err instanceof Error ? err.message : String(err)}`
        }
    },
}

// ─── delete_file ───────────────────────────────────────────────

export const deleteFileTool: ToolRegistration = {
    definition: {
        name: "delete_file",
        description:
            "Delete a single file from the TapWord virtual filesystem. " +
            "The path must be an absolute virtual FS path starting with /tapword/.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Absolute file path to delete (e.g., '/tapword/skills/old-skill/notes.txt')",
                },
            },
            required: ["path"],
        },
    },
    label: "Deleting file...",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const path = input.path as string
        const error = validatePath(path)
        if (error) return `Error: ${error}`

        try {
            await tapWordFS.deleteFile(path)

            // Check if path still exists — if so, it's likely a directory
            const stillExists = await tapWordFS.exists(path)
            if (stillExists) {
                logger.warn(`Path still exists after deleteFile: '${path}' (likely a directory)`)
                return `No file found at path. If this is a directory, use delete_directory instead.`
            }

            logger.info(`Deleted file '${path}'`)
            return `Deleted file: ${path}`
        } catch (err) {
            logger.error(`Failed to delete file '${path}'`, err)
            return `Error: Failed to delete file ${path}: ${err instanceof Error ? err.message : String(err)}`
        }
    },
}

// ─── read_file ─────────────────────────────────────────────────

export const readFileTool: ToolRegistration = {
    definition: {
        name: "read_file",
        description:
            "Read the content of a file from the TapWord virtual filesystem. " +
            "Use this to read supplementary files within a skill folder (e.g., examples, fixtures). " +
            "The path must be an absolute virtual FS path starting with /tapword/.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Absolute path (e.g., '/tapword/skills/e2e-testing/examples/login.spec.ts')",
                },
            },
            required: ["path"],
        },
    },
    label: "Reading file...",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const path = input.path as string
        const error = validatePath(path)
        if (error) return `Error: ${error}`

        try {
            const content = await tapWordFS.readFile(path)
            logger.info(`Read file '${path}': ${content.length} chars`)
            return content
        } catch {
            logger.warn(`File not found: ${path}`)
            return `File not found: ${path}`
        }
    },
}

// ─── delete_directory ──────────────────────────────────────────

export const deleteDirectoryTool: ToolRegistration = {
    definition: {
        name: "delete_directory",
        description:
            "Recursively delete a directory and all its contents from the TapWord virtual filesystem. " +
            "The path must be an absolute virtual FS path starting with /tapword/.",
        input_schema: {
            type: "object" as const,
            properties: {
                path: {
                    type: "string",
                    description: "Absolute directory path to delete (e.g., '/tapword/skills/old-skill/')",
                },
            },
            required: ["path"],
        },
    },
    label: "Deleting directory...",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const path = input.path as string
        const error = validatePath(path)
        if (error) return `Error: ${error}`

        // Safety guard: block deletion of the root directory
        const normalized = path.replace(/\/+$/, "")
        if (normalized === VFS_ROOT) {
            return `Error: Cannot delete the root directory.`
        }

        try {
            await tapWordFS.deleteDir(path)
            logger.info(`Deleted directory '${path}'`)
            return `Deleted directory: ${path}`
        } catch (err) {
            logger.error(`Failed to delete directory '${path}'`, err)
            return `Error: Failed to delete directory ${path}: ${err instanceof Error ? err.message : String(err)}`
        }
    },
}

// Self-register with the global tool registry
import { toolRegistry } from "./ToolRegistry"
toolRegistry.add(readFileTool)
toolRegistry.add(listDirectoryTool)
toolRegistry.add(writeFileTool)
toolRegistry.add(deleteFileTool)
toolRegistry.add(deleteDirectoryTool)
