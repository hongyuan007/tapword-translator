import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("TapWordFS")

const TAPWORD_ROOT = "tapword"
const PATH_PREFIX = "/tapword/"

/** Absolute VFS root path without trailing slash (e.g., "/tapword"). */
export const VFS_ROOT = "/tapword"
/** Absolute VFS root path with trailing slash (e.g., "/tapword/"). */
export const VFS_PATH_PREFIX = PATH_PREFIX

// ─── Public Types ──────────────────────────────────────────────

/** Metadata returned by stat(). */
export interface FileStat {
    name: string
    /** File size in bytes. */
    size: number
    /** Last modified timestamp (epoch ms). */
    lastModified: number
}

/** Entry returned by listDir(). */
export interface DirEntry {
    name: string
    kind: "file" | "directory"
}

// ─── Public Interface ──────────────────────────────────────────

/** Public API for TapWordFS. */
export interface ITapWordFS {
    readFile(path: string): Promise<string>
    writeFile(path: string, content: string): Promise<void>
    deleteFile(path: string): Promise<void>
    /** Recursively delete a directory and all its contents. */
    deleteDir(path: string): Promise<void>
    listDir(path: string): Promise<DirEntry[]>
    exists(path: string): Promise<boolean>
    stat(path: string): Promise<FileStat>
}

// ─── TapWordFS Class ──────────────────────────────────────────

/**
 * Thin wrapper around OPFS scoped under /tapword/.
 * All paths must start with `/tapword/`.
 */
class TapWordFS implements ITapWordFS {
    private rootPromise: Promise<FileSystemDirectoryHandle> | null = null

    /** Lazily acquire the /tapword/ directory handle (created on first access). */
    private getRoot(): Promise<FileSystemDirectoryHandle> {
        if (!this.rootPromise) {
            this.rootPromise = navigator.storage
                .getDirectory()
                .then((opfsRoot) => opfsRoot.getDirectoryHandle(TAPWORD_ROOT, { create: true }))
        }
        return this.rootPromise
    }

    /** Split a validated path into directory segments and a final name. */
    private parsePath(path: string): { segments: string[]; name: string } {
        if (!path.startsWith(PATH_PREFIX)) {
            throw new Error(`Invalid path: must start with ${PATH_PREFIX}. Got: ${path}`)
        }
        const relative = path.slice(PATH_PREFIX.length).replace(/\/+$/, "")
        if (!relative) {
            throw new Error("Path must specify at least one segment after /tapword/")
        }
        const parts = relative.split("/").filter(Boolean)
        return { segments: parts.slice(0, -1), name: parts[parts.length - 1]! }
    }

    /** Walk directory segments, optionally creating intermediate directories. */
    private async resolveDir(
        segments: string[],
        create: boolean
    ): Promise<FileSystemDirectoryHandle> {
        let dir = await this.getRoot()
        for (const seg of segments) {
            dir = await dir.getDirectoryHandle(seg, { create })
        }
        return dir
    }

    /** Read a file's full content as UTF-8 string. Throws if not found. */
    async readFile(path: string): Promise<string> {
        const { segments, name } = this.parsePath(path)
        const dir = await this.resolveDir(segments, false)
        const handle = await dir.getFileHandle(name)
        const file = await handle.getFile()
        return file.text()
    }

    /** Write UTF-8 content to a file. Creates parent directories as needed. */
    async writeFile(path: string, content: string): Promise<void> {
        const { segments, name } = this.parsePath(path)
        const dir = await this.resolveDir(segments, true)
        const handle = await dir.getFileHandle(name, { create: true })
        let writable: FileSystemWritableFileStream | null = null

        try {
            writable = await handle.createWritable()
            await writable.write(content)
            await writable.close()
            logger.info(`Wrote ${content.length} chars to ${path}`)
        } catch (error) {
            logger.error(`Failed to write ${content.length} chars to ${path}`, error)

            if (writable) {
                try {
                    await writable.abort()
                } catch {}
            }

            throw error
        }
    }

    /** Delete a file. No-op if the file does not exist. */
    async deleteFile(path: string): Promise<void> {
        const { segments, name } = this.parsePath(path)
        try {
            const dir = await this.resolveDir(segments, false)
            await dir.removeEntry(name)
            logger.info(`Deleted ${path}`)
        } catch {
            // File or parent dir does not exist — treat as no-op
        }
    }

    /** Recursively delete a directory and all its contents. No-op if the directory does not exist. */
    async deleteDir(path: string): Promise<void> {
        const { segments, name } = this.parsePath(path)
        try {
            const dir = await this.resolveDir(segments, false)
            await dir.removeEntry(name, { recursive: true })
            logger.info(`Deleted directory ${path}`)
        } catch {
            // Directory or parent does not exist — treat as no-op
        }
    }

    /** List entries (files and subdirectories) in a directory. Returns [] for empty/missing dirs. */
    async listDir(path: string): Promise<DirEntry[]> {
        const normalizedPath = path.endsWith("/") ? path : path + "/"
        if (!normalizedPath.startsWith(PATH_PREFIX)) {
            throw new Error(`Invalid path: must start with ${PATH_PREFIX}`)
        }
        const relative = normalizedPath.slice(PATH_PREFIX.length).replace(/\/+$/, "")
        const segments = relative ? relative.split("/").filter(Boolean) : []

        try {
            const dir = await this.resolveDir(segments, false)
            const entries: DirEntry[] = []
            // TS DOM typings lack asyncIterator on FileSystemDirectoryHandle
            for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
                entries.push({ name, kind: handle.kind as "file" | "directory" })
            }
            return entries
        } catch {
            return []
        }
    }

    /** Check whether a file or directory exists at the given path. */
    async exists(path: string): Promise<boolean> {
        try {
            const { segments, name } = this.parsePath(path)
            const dir = await this.resolveDir(segments, false)
            try {
                await dir.getFileHandle(name)
                return true
            } catch {
                await dir.getDirectoryHandle(name)
                return true
            }
        } catch {
            return false
        }
    }

    /** Get file metadata. Throws if not found. */
    async stat(path: string): Promise<FileStat> {
        const { segments, name } = this.parsePath(path)
        const dir = await this.resolveDir(segments, false)
        const handle = await dir.getFileHandle(name)
        const file = await handle.getFile()
        return {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
        }
    }
}

/** Singleton instance — import this throughout the sidepanel module. */
export const tapWordFS = new TapWordFS()
