import * as loggerModule from "@/0_common/utils/logger"
import * as tapWordFSModule from "@/13_sidepanel/services/TapWordFS"
import type { SkillMeta } from "@/13_sidepanel/types"

// ─── Public Interface ──────────────────────────────────────────

/** Public API for SkillStorageService. */
export interface ISkillStorageService {
    loadSkillMetas(): Promise<SkillMeta[]>
    importSkill(folderName: string, files: Array<{ relativePath: string; content: string }>): Promise<SkillMeta>
    deleteSkill(skillId: string): Promise<void>
    getSkillBody(skillId: string): Promise<string | null>
    getSkillFiles(skillId: string): Promise<string[]>
    readSkillFile(skillId: string, relativePath: string): Promise<string>
    toggleSkillEnabled(skillId: string, enabled: boolean): Promise<void>
}

// ─── Constants ─────────────────────────────────────────────────

const logger = loggerModule.createLogger("SkillStorageService")

const SKILLS_DIR = `${tapWordFSModule.VFS_ROOT}/skills`
const INDEX_FILE = `${tapWordFSModule.VFS_ROOT}/skills/.index.json`
const ENTRY_DOCUMENT = "SKILL.md"
const CURRENT_DIRECTORY = "."
const PARENT_DIRECTORY = ".."

// ─── Public Helpers ────────────────────────────────────────────

/** Parse YAML frontmatter from a markdown string. */
export function parseSkillFile(
    content: string,
    fileName: string
): { name: string; description: string; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/)
    let meta: Record<string, string> = {}
    let body: string

    if (match) {
        for (const line of match[1]!.trim().split("\n")) {
            const colonIdx = line.indexOf(":")
            if (colonIdx > 0) {
                const key = line.slice(0, colonIdx).trim()
                const val = line.slice(colonIdx + 1).trim()
                meta[key] = val
            }
        }
        body = match[2]!.trim()
    } else {
        body = content.trim()
    }

    const baseName = fileName.replace(/\.(md|txt)$/, "")
    const name = meta["name"] || baseName
    const description =
        meta["description"] ||
        body.split("\n").find((line) => line.trim().length > 0)?.slice(0, 100) ||
        "No description"

    return { name, description, body }
}

/** Sanitize a folder name into a valid skill ID: lowercase, alphanumeric + hyphens. */
export function sanitizeFolderName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
}

// ─── Private Helpers ───────────────────────────────────────────

function normalizeImportedRelativePath(relativePath: string): string {
    const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
    if (!normalizedPath) {
        throw new Error("Cannot import skill: encountered an empty relative path.")
    }

    const segments = normalizedPath.split("/").filter(Boolean)
    if (!segments.length) {
        throw new Error(`Cannot import skill: invalid relative path '${relativePath}'.`)
    }

    if (segments.some((segment) => segment === CURRENT_DIRECTORY || segment === PARENT_DIRECTORY)) {
        throw new Error(`Cannot import skill: relative path '${relativePath}' contains forbidden traversal segments.`)
    }

    return segments.join("/")
}

/** Recursively list all file paths under a directory, returning paths relative to the given prefix. */
async function listFilesRecursive(dirPath: string, prefix: string): Promise<string[]> {
    const entries = await tapWordFSModule.tapWordFS.listDir(dirPath)
    const results: string[] = []

    for (const entry of entries) {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (entry.kind === "file") {
            results.push(relativePath)
        } else if (entry.kind === "directory") {
            const subFiles = await listFilesRecursive(`${dirPath}/${entry.name}`, relativePath)
            results.push(...subFiles)
        }
    }

    return results
}

/** Read the index file, returning [] on any failure. */
async function readIndex(): Promise<SkillMeta[]> {
    try {
        const raw = await tapWordFSModule.tapWordFS.readFile(INDEX_FILE)
        const parsed = JSON.parse(raw) as SkillMeta[]
        return parsed.map((m) => ({
            ...m,
            enabled: m.enabled ?? true,
            folderPath: m.folderPath ?? `${SKILLS_DIR}/${m.id}`,
            files: m.files ?? [ENTRY_DOCUMENT],
        }))
    } catch {
        return []
    }
}

/** Persist the index file. */
async function writeIndex(metas: SkillMeta[]): Promise<void> {
    await tapWordFSModule.tapWordFS.writeFile(INDEX_FILE, JSON.stringify(metas, null, 2))
}

/** Rebuild index by scanning subdirectories in /tapword/skills/. */
async function rebuildIndex(): Promise<SkillMeta[]> {
    logger.info("Rebuilding skill index from filesystem...")
    const entries = await tapWordFSModule.tapWordFS.listDir(SKILLS_DIR)
    const metas: SkillMeta[] = []

    for (const entry of entries) {
        if (entry.kind !== "directory") continue
        try {
            const folderPath = `${SKILLS_DIR}/${entry.name}`
            const content = await tapWordFSModule.tapWordFS.readFile(`${folderPath}/${ENTRY_DOCUMENT}`)
            const { name, description } = parseSkillFile(content, ENTRY_DOCUMENT)
            const files = await listFilesRecursive(folderPath, "")
            metas.push({
                id: entry.name,
                name,
                description,
                folderName: entry.name,
                folderPath,
                files,
                importedAt: Date.now(),
                enabled: true,
            })
        } catch (err) {
            logger.warn(`Skipping directory '${entry.name}': missing or unreadable ${ENTRY_DOCUMENT}`, err)
        }
    }

    await writeIndex(metas)
    logger.info(`Index rebuilt with ${metas.length} skills`)
    return metas
}

// ─── SkillStorageService Class ─────────────────────────────────

export class SkillStorageService implements ISkillStorageService {

    /** Load metadata-only list for Layer 1 injection and UI display. */
    async loadSkillMetas(): Promise<SkillMeta[]> {
        const metas = await readIndex()
        if (metas.length > 0) return metas

        const hasDir = await tapWordFSModule.tapWordFS.exists(SKILLS_DIR)
        if (!hasDir) return []

        return rebuildIndex()
    }

    /** Import a skill from a folder of files. Overwrites if same ID exists. */
    async importSkill(
        folderName: string,
        files: Array<{ relativePath: string; content: string }>
    ): Promise<SkillMeta> {
        if (!files.length) {
            throw new Error("Cannot import skill: no files provided.")
        }

        const id = sanitizeFolderName(folderName)
        if (!id) {
            throw new Error(`Cannot import skill: folder name '${folderName}' is invalid after sanitization.`)
        }

        const normalizedFiles = files.map((file) => ({
            relativePath: normalizeImportedRelativePath(file.relativePath),
            content: file.content,
        }))

        const entryFile = normalizedFiles.find((file) => file.relativePath === ENTRY_DOCUMENT)
        if (!entryFile) {
            throw new Error(`Cannot import skill: '${ENTRY_DOCUMENT}' is required but was not found in the folder.`)
        }

        const { name, description, body } = parseSkillFile(entryFile.content, ENTRY_DOCUMENT)
        const folderPath = `${SKILLS_DIR}/${id}`
        logger.info(`Importing skill '${id}' from folder '${folderName}' with ${normalizedFiles.length} files`)

        await tapWordFSModule.tapWordFS.deleteDir(folderPath)

        for (const file of normalizedFiles) {
            try {
                await tapWordFSModule.tapWordFS.writeFile(`${folderPath}/${file.relativePath}`, file.content)
            } catch (error) {
                logger.error(`Failed while writing imported skill file '${file.relativePath}' for skill '${id}'`, error)
                throw error
            }
        }

        const meta: SkillMeta = {
            id,
            name,
            description,
            folderName: id,
            folderPath,
            files: normalizedFiles.map((file) => file.relativePath),
            importedAt: Date.now(),
            enabled: true,
        }

        const metas = await readIndex()
        const updated = metas.filter((m) => m.id !== id)
        updated.push(meta)
        await writeIndex(updated)

        logger.info(`Imported skill '${id}' (${files.length} files, ${body.length} chars body)`)
        return meta
    }

    /** Delete a skill by ID (removes entire folder). */
    async deleteSkill(skillId: string): Promise<void> {
        await tapWordFSModule.tapWordFS.deleteDir(`${SKILLS_DIR}/${skillId}`)

        const metas = await readIndex()
        await writeIndex(metas.filter((m) => m.id !== skillId))
        logger.info(`Deleted skill '${skillId}'`)
    }

    /** Get a single skill's full body content by ID (reads SKILL.md). */
    async getSkillBody(skillId: string): Promise<string | null> {
        try {
            const content = await tapWordFSModule.tapWordFS.readFile(`${SKILLS_DIR}/${skillId}/${ENTRY_DOCUMENT}`)
            const { body } = parseSkillFile(content, ENTRY_DOCUMENT)
            return body
        } catch {
            return null
        }
    }

    /** Recursively list all files in a skill folder, returning relative paths. */
    async getSkillFiles(skillId: string): Promise<string[]> {
        const folderPath = `${SKILLS_DIR}/${skillId}`
        return listFilesRecursive(folderPath, "")
    }

    /** Read an arbitrary file from a skill folder. */
    async readSkillFile(skillId: string, relativePath: string): Promise<string> {
        return tapWordFSModule.tapWordFS.readFile(`${SKILLS_DIR}/${skillId}/${relativePath}`)
    }

    /** Toggle the enabled status of a skill in the index (no file rewrite). */
    async toggleSkillEnabled(skillId: string, enabled: boolean): Promise<void> {
        const metas = await readIndex()
        const updated = metas.map((m) => (m.id === skillId ? { ...m, enabled } : m))
        await writeIndex(updated)
        logger.info(`Skill '${skillId}' ${enabled ? "enabled" : "disabled"}`)
    }
}

/** Module-level singleton instance. */
export const skillStorageService = new SkillStorageService()
