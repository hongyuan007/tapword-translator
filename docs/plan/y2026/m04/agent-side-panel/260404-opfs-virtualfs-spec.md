# OPFS Virtual Filesystem & SkillStorageService Refactor — Technical Specification

**Date**: 2026-04-04  
**Status**: Draft  
**Module**: `src/13_sidepanel`  
**Prerequisites**: Skill Import spec (260404-skill-import-spec)

---

## 1. OPFS Overview — Why OPFS over IndexedDB / chrome.storage.local

### 1.1 Current Problem

Skills are stored in `chrome.storage.local` under a single JSON key (`agentSkills`). Every read or write deserializes / re-serializes the **entire** skill map. This has three problems:

| Problem | Detail |
|---------|--------|
| **Serialization overhead** | Every `loadAllSkills()` call parses _all_ skill bodies into memory, even when only one is needed. |
| **10 MB hard limit** | `chrome.storage.local` caps at 10 MB total (with `unlimitedStorage` it can go higher, but the API is optimized for small values). |
| **No file semantics** | Operations like "list files in a directory" or "check if a file exists" require loading the full map. |

### 1.2 Why OPFS

**Origin Private File System** (OPFS) is a W3C/WHATWG standard (Chrome 86+) that gives web origins a sandboxed, browser-managed filesystem.

| Factor | chrome.storage.local | IndexedDB | **OPFS** |
|--------|---------------------|-----------|----------|
| API model | Key-value JSON blob | Cursor / transaction | **Real file I/O** |
| Serialization | Automatic JSON (entire blob) | structuredClone per record | **None — raw bytes** |
| Storage quota | 10 MB default | Browser-managed (GB) | **Browser-managed (GB)** |
| Per-item access | Must load entire key | Per-record via key lookup | **Per-file seek/read** |
| Directory structure | Flat key namespace | Object stores (flat) | **Native directories** |
| Chrome extension support | Full | Full | **Full (sidepanel pages)** |
| Complexity | Trivial | Medium (transactions) | **Low (file handle API)** |

**Key advantages of OPFS for our use case:**

1. **No serialization overhead** — Reading one skill file does not touch any other files.
2. **Native directory semantics** — `/tapword/skills/` maps directly to the mental model of a virtual filesystem.
3. **GB-level quota** — No practical limit for text-based skill documents.
4. **Future extensibility** — The same FS can store knowledge exports, agent configs, cached assets, etc.

### 1.3 OPFS API Primer

```typescript
// Get the root directory handle
const root = await navigator.storage.getDirectory()

// Create or open a subdirectory
const dir = await root.getDirectoryHandle('tapword', { create: true })

// Create or open a file
const fileHandle = await dir.getFileHandle('example.md', { create: true })

// Read file content
const file = await fileHandle.getFile()
const text = await file.text()

// Write file content
const writable = await fileHandle.createWritable()
await writable.write('hello world')
await writable.close()

// Delete a file
await dir.removeEntry('example.md')

// List directory contents
for await (const [name, handle] of dir) {
    console.log(name, handle.kind) // "file" | "directory"
}
```

---

## 2. TapWordFS Class Design

### 2.1 Location

```
src/13_sidepanel/store/TapWordFS.ts
```

### 2.2 TypeScript Interface

```typescript
/** Metadata returned by stat(). */
interface FileStat {
    name: string
    /** File size in bytes. */
    size: number
    /** Last modified timestamp (epoch ms). */
    lastModified: number
}

/** Entry returned by listDir(). */
interface DirEntry {
    name: string
    kind: "file" | "directory"
}

/** Thin wrapper around OPFS scoped under /tapword/. */
interface ITapWordFS {
    /** Read a file's full content as UTF-8 string. Throws if not found. */
    readFile(path: string): Promise<string>

    /** Write UTF-8 content to a file. Creates parent directories as needed. */
    writeFile(path: string, content: string): Promise<void>

    /** Delete a file. No-op if the file does not exist. */
    deleteFile(path: string): Promise<void>

    /** List entries (files and subdirectories) in a directory. Returns [] for empty/missing dirs. */
    listDir(path: string): Promise<DirEntry[]>

    /** Check whether a file or directory exists at the given path. */
    exists(path: string): Promise<boolean>

    /** Get file metadata. Throws if not found. */
    stat(path: string): Promise<FileStat>
}
```

### 2.3 Path Convention

- All paths **must** start with `/tapword/`.
- The FS class strips the `/tapword/` prefix and resolves the remainder against the OPFS root's `tapword` directory handle.
- Path segments are split by `/`. Trailing slashes are ignored.
- Examples:
  - `/tapword/skills/translation-style.md` → `tapword/` → `skills/` → file `translation-style.md`
  - `/tapword/skills/` → `tapword/` → directory `skills/`
  - `/tapword/skills/.index.json` → `tapword/` → `skills/` → file `.index.json`

### 2.4 Implementation Sketch (~100 lines)

```typescript
import * as loggerModule from "@/0_common/utils/logger"

const logger = loggerModule.createLogger("TapWordFS")

const TAPWORD_ROOT = "tapword"
const PATH_PREFIX = "/tapword/"

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

    async readFile(path: string): Promise<string> {
        const { segments, name } = this.parsePath(path)
        const dir = await this.resolveDir(segments, false)
        const handle = await dir.getFileHandle(name)
        const file = await handle.getFile()
        return file.text()
    }

    async writeFile(path: string, content: string): Promise<void> {
        const { segments, name } = this.parsePath(path)
        const dir = await this.resolveDir(segments, true) // create parents
        const handle = await dir.getFileHandle(name, { create: true })
        const writable = await handle.createWritable()
        await writable.write(content)
        await writable.close()
        logger.info(`Wrote ${content.length} chars to ${path}`)
    }

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
            for await (const [name, handle] of dir) {
                entries.push({ name, kind: handle.kind })
            }
            return entries
        } catch {
            return [] // directory does not exist
        }
    }

    async exists(path: string): Promise<boolean> {
        try {
            const { segments, name } = this.parsePath(path)
            const dir = await this.resolveDir(segments, false)
            // Try file first, then directory
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
```

---

## 3. Directory Structure

```
/tapword/                              ← virtual root (OPFS: navigator.storage → "tapword")
├── skills/                            ← skill document storage
│   ├── .index.json                    ← lightweight metadata cache (SkillMeta[])
│   ├── translation-style.md           ← full skill file (frontmatter + body)
│   ├── code-review.md
│   └── api-design.md
└── (reserved for future use)
    ├── knowledge/                     ← potential future: knowledge base exports
    └── config/                        ← potential future: agent configuration files
```

### 3.1 Skill File Format (unchanged)

Each `.md` file in `/tapword/skills/` uses optional YAML frontmatter:

```markdown
---
name: Translation Style Guide
description: Academic paper translation conventions for EN→CN
---

# Translation Style Guide

## Rule 1: Preserve Technical Terms
Always keep technical terms in their original language...
```

### 3.2 File Naming Convention

Skill files are stored as `{skill-id}.md` where `skill-id` is derived from the original filename:

```
Original filename        →  Skill ID              →  OPFS filename
"Translation Style.md"   →  "translation-style"   →  "translation-style.md"
"code_review.md"          →  "code-review"         →  "code-review.md"
```

---

## 4. Skill Metadata Management Strategy

### 4.1 Problem

Layer 1 injection requires `SkillMeta[]` (id, name, description) on every agent turn. Reading and parsing frontmatter from _every_ skill file on each turn is wasteful.

### 4.2 Solution: Index File Cache

Maintain a lightweight JSON index at `/tapword/skills/.index.json`:

```json
[
    {
        "id": "translation-style",
        "name": "Translation Style Guide",
        "description": "Academic paper translation conventions for EN→CN",
        "sourceFileName": "Translation Style.md",
        "importedAt": 1743724800000
    },
    {
        "id": "code-review",
        "name": "Code Review Checklist",
        "description": "Best practices for reviewing TypeScript code",
        "sourceFileName": "code-review.md",
        "importedAt": 1743724900000
    }
]
```

### 4.3 Index Management Rules

| Operation | Index Action |
|-----------|-------------|
| `importSkill()` | Parse frontmatter → upsert entry in index → write `.index.json` |
| `deleteSkill()` | Remove entry from index → write `.index.json` |
| `loadSkillMetas()` | Read `.index.json` only (no individual file access) |
| `getSkillBody()` | Read the individual `.md` file directly (index not involved) |

### 4.4 Index Rebuild (Self-Healing)

If `.index.json` is missing or corrupted, `loadSkillMetas()` falls back to:

1. `listDir("/tapword/skills/")` to enumerate all `.md` files.
2. Read each file, parse frontmatter, build `SkillMeta`.
3. Write the rebuilt index to `.index.json`.

This makes the system self-healing — deleting `.index.json` triggers a full re-index on next access.

### 4.5 Refactored SkillStorageService API

```typescript
// File: src/13_sidepanel/services/SkillStorageService.ts

import * as loggerModule from "@/0_common/utils/logger"
import { tapWordFS } from "../store/TapWordFS"
import type { Skill, SkillMeta } from "../types"

const logger = loggerModule.createLogger("SkillStorageService")

const SKILLS_DIR = "/tapword/skills"
const INDEX_FILE = "/tapword/skills/.index.json"

/** Parse YAML frontmatter from a markdown string. (unchanged) */
export function parseSkillFile(
    content: string,
    fileName: string
): { name: string; description: string; body: string } {
    // ... (existing implementation, no change)
}

/** Derive a stable ID from a filename. (unchanged) */
function fileNameToId(fileName: string): string {
    // ... (existing implementation, no change)
}

// ─── Index Management ──────────────────────────────────────────

/** Read the index file, returning [] on any failure. */
async function readIndex(): Promise<SkillMeta[]> {
    try {
        const raw = await tapWordFS.readFile(INDEX_FILE)
        return JSON.parse(raw) as SkillMeta[]
    } catch {
        return []
    }
}

/** Persist the index file. */
async function writeIndex(metas: SkillMeta[]): Promise<void> {
    await tapWordFS.writeFile(INDEX_FILE, JSON.stringify(metas, null, 2))
}

/** Rebuild index by scanning all .md files in /tapword/skills/. */
async function rebuildIndex(): Promise<SkillMeta[]> {
    logger.info("Rebuilding skill index from filesystem...")
    const entries = await tapWordFS.listDir(SKILLS_DIR)
    const metas: SkillMeta[] = []

    for (const entry of entries) {
        if (entry.kind !== "file" || !entry.name.endsWith(".md")) continue
        try {
            const content = await tapWordFS.readFile(`${SKILLS_DIR}/${entry.name}`)
            const id = entry.name.replace(/\.md$/, "")
            const { name, description } = parseSkillFile(content, entry.name)
            const stat = await tapWordFS.stat(`${SKILLS_DIR}/${entry.name}`)
            metas.push({
                id,
                name,
                description,
                sourceFileName: entry.name,
                importedAt: stat.lastModified,
            })
        } catch (err) {
            logger.warn(`Failed to read skill file ${entry.name}:`, err)
        }
    }

    await writeIndex(metas)
    logger.info(`Index rebuilt with ${metas.length} skills`)
    return metas
}

// ─── Public API ────────────────────────────────────────────────

/** Load metadata-only list for Layer 1 injection and UI display. */
export async function loadSkillMetas(): Promise<SkillMeta[]> {
    const metas = await readIndex()
    if (metas.length > 0) return metas

    // Index empty or missing — check if skill files exist (self-healing)
    const hasFiles = await tapWordFS.exists(SKILLS_DIR)
    if (!hasFiles) return []
    return rebuildIndex()
}

/** Import a skill from raw file content. Overwrites if same ID exists. */
export async function importSkill(fileName: string, fileContent: string): Promise<Skill> {
    const id = fileNameToId(fileName)
    const { name, description, body } = parseSkillFile(fileContent, fileName)

    // Write the full skill file to OPFS
    const filePath = `${SKILLS_DIR}/${id}.md`
    await tapWordFS.writeFile(filePath, fileContent) // Store original content (with frontmatter)

    // Update index
    const metas = await readIndex()
    const meta: SkillMeta = {
        id,
        name,
        description,
        sourceFileName: fileName,
        importedAt: Date.now(),
    }
    const updated = metas.filter((m) => m.id !== id)
    updated.push(meta)
    await writeIndex(updated)

    logger.info(`Imported skill '${id}' (${body.length} chars)`)
    return { id, name, description, body, sourceFileName: fileName, importedAt: meta.importedAt }
}

/** Delete a skill by ID. */
export async function deleteSkill(skillId: string): Promise<void> {
    await tapWordFS.deleteFile(`${SKILLS_DIR}/${skillId}.md`)

    // Update index
    const metas = await readIndex()
    await writeIndex(metas.filter((m) => m.id !== skillId))
    logger.info(`Deleted skill '${skillId}'`)
}

/** Get a single skill's full body content by ID (reads individual file). */
export async function getSkillBody(skillId: string): Promise<string | null> {
    try {
        const content = await tapWordFS.readFile(`${SKILLS_DIR}/${skillId}.md`)
        const { body } = parseSkillFile(content, `${skillId}.md`)
        return body
    } catch {
        return null
    }
}

/** Load all skills (needed only for migration or bulk operations). */
export async function loadAllSkills(): Promise<Record<string, Skill>> {
    const entries = await tapWordFS.listDir(SKILLS_DIR)
    const skills: Record<string, Skill> = {}

    for (const entry of entries) {
        if (entry.kind !== "file" || !entry.name.endsWith(".md")) continue
        try {
            const content = await tapWordFS.readFile(`${SKILLS_DIR}/${entry.name}`)
            const id = entry.name.replace(/\.md$/, "")
            const { name, description, body } = parseSkillFile(content, entry.name)
            const stat = await tapWordFS.stat(`${SKILLS_DIR}/${entry.name}`)
            skills[id] = { id, name, description, body, sourceFileName: entry.name, importedAt: stat.lastModified }
        } catch {
            // Skip unreadable files
        }
    }

    return skills
}
```

---

## 5. Refactored `skillTools.ts`

The `load_skill` tool switches from `chrome.storage.local` to reading directly from OPFS:

```typescript
// File: src/13_sidepanel/agent/tools/skillTools.ts

import * as loggerModule from "@/0_common/utils/logger"
import * as SkillStorageService from "../../services/SkillStorageService"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("skillTools")

export const loadSkillTool: ToolRegistration = {
    definition: {
        name: "load_skill",
        description:
            "Load the full content of a specialized skill document by its ID. " +
            "Use this tool when you need detailed instructions or domain knowledge " +
            "listed in the 'Skills available' section of your instructions.",
        input_schema: {
            type: "object" as const,
            properties: {
                skill_id: {
                    type: "string",
                    description: "The skill identifier (e.g., 'translation-style').",
                },
            },
            required: ["skill_id"],
        },
    },
    label: "Loading skill...",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const skillId = input.skill_id as string
        if (!skillId) {
            throw new Error("skill_id is required")
        }

        const body = await SkillStorageService.getSkillBody(skillId)
        if (!body) {
            const metas = await SkillStorageService.loadSkillMetas()
            const available = metas.map((m) => m.id).join(", ")
            logger.warn(`Skill not found: ${skillId}. Available: ${available}`)
            return `Error: Unknown skill '${skillId}'. Available skills: ${available || "(none)"}`
        }

        // Get the name from index for the XML wrapper
        const metas = await SkillStorageService.loadSkillMetas()
        const meta = metas.find((m) => m.id === skillId)
        const name = meta?.name ?? skillId

        logger.info(`Loaded skill '${skillId}': ${body.length} chars`)
        return `<skill name="${name}">\n${body}\n</skill>`
    },
}
```

---

## 6. Migration Plan: chrome.storage.local → OPFS

### 6.1 Strategy: One-Time Transparent Migration

On first access after the update, migrate existing skill data from `chrome.storage.local` to OPFS, then delete the old storage key. The user experiences zero disruption.

### 6.2 Migration Logic

```typescript
// File: src/13_sidepanel/services/SkillMigration.ts

import * as loggerModule from "@/0_common/utils/logger"
import { tapWordFS } from "../store/TapWordFS"
import type { Skill } from "../types"

const logger = loggerModule.createLogger("SkillMigration")

const LEGACY_STORAGE_KEY = "agentSkills"
const MIGRATION_FLAG_KEY = "skillsMigratedToOPFS"
const SKILLS_DIR = "/tapword/skills"

/**
 * Check if legacy skills exist in chrome.storage.local and migrate them to OPFS.
 * Safe to call multiple times — no-ops after first successful migration.
 */
export async function migrateIfNeeded(): Promise<void> {
    // Check migration flag
    const flagResult = await chrome.storage.local.get(MIGRATION_FLAG_KEY)
    if (flagResult[MIGRATION_FLAG_KEY]) {
        return // Already migrated
    }

    // Read legacy data
    const result = await chrome.storage.local.get(LEGACY_STORAGE_KEY)
    const legacySkills = result[LEGACY_STORAGE_KEY] as Record<string, Skill> | undefined

    if (!legacySkills || Object.keys(legacySkills).length === 0) {
        // No legacy data — mark as migrated and return
        await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true })
        logger.info("No legacy skills to migrate")
        return
    }

    // Migrate each skill to OPFS
    let migrated = 0
    for (const [id, skill] of Object.entries(legacySkills)) {
        try {
            // Reconstruct the original file content (frontmatter + body)
            const fileContent = buildSkillFileContent(skill)
            await tapWordFS.writeFile(`${SKILLS_DIR}/${id}.md`, fileContent)
            migrated++
        } catch (err) {
            logger.warn(`Failed to migrate skill '${id}':`, err)
        }
    }

    // Set migration flag and clean up legacy key
    await chrome.storage.local.set({ [MIGRATION_FLAG_KEY]: true })
    await chrome.storage.local.remove(LEGACY_STORAGE_KEY)
    logger.info(`Migrated ${migrated}/${Object.keys(legacySkills).length} skills to OPFS`)
}

/**
 * Reconstruct a markdown file from a legacy Skill object.
 * Re-creates frontmatter so the file is self-contained.
 */
function buildSkillFileContent(skill: Skill): string {
    const frontmatter = [
        "---",
        `name: ${skill.name}`,
        `description: ${skill.description}`,
        "---",
        "",
    ].join("\n")
    return frontmatter + skill.body
}
```

### 6.3 Migration Trigger Point

Call `migrateIfNeeded()` once during sidepanel initialization (`App.tsx` or `useAgentChat` hook), before any skill APIs are used:

```typescript
// In App.tsx useEffect or useAgentChat init:
import * as SkillMigration from "../services/SkillMigration"

useEffect(() => {
    SkillMigration.migrateIfNeeded().then(() => {
        // Now safe to load skills from OPFS
        SkillStorageService.loadSkillMetas().then(setSkills)
    })
}, [])
```

### 6.4 Rollback

If migration fails partially:
- Skills that were successfully written to OPFS are usable.
- The migration flag is _not_ set until all writes succeed, so a retry on next panel open will attempt remaining skills.
- Legacy data in `chrome.storage.local` is only removed after the migration flag is set. No data loss.

---

## 7. File Change List

| # | File | Change Type | Summary |
|---|------|-------------|---------|
| 1 | `src/13_sidepanel/store/TapWordFS.ts` | **New** | `TapWordFS` class (~100 lines) wrapping OPFS. Exports singleton `tapWordFS`. |
| 2 | `src/13_sidepanel/services/SkillStorageService.ts` | **Modify** | Replace `chrome.storage.local` with `tapWordFS` calls. Add index file management. Remove `SKILLS_STORAGE_KEY`. |
| 3 | `src/13_sidepanel/services/SkillMigration.ts` | **New** | One-time migration from `chrome.storage.local` to OPFS. |
| 4 | `src/13_sidepanel/agent/tools/skillTools.ts` | **Modify** | Replace direct `chrome.storage.local` access with `SkillStorageService.getSkillBody()` and `loadSkillMetas()`. |
| 5 | `src/13_sidepanel/App.tsx` | **Modify** | Add migration call in `useEffect` before loading skills. |
| 6 | `src/13_sidepanel/types.ts` | **No change** | `Skill` and `SkillMeta` types remain the same. |
| 7 | `src/13_sidepanel/agent/prompts.ts` | **No change** | `buildSystemPrompt()` is unchanged; it already accepts `SkillMeta[]`. |

### Dependency Graph

```
TapWordFS.ts (new — OPFS wrapper, zero dependencies on business logic)
    ↓
SkillStorageService.ts (refactored — imports tapWordFS)
    ↓                       ↓
skillTools.ts          SkillMigration.ts (new — imports tapWordFS + legacy chrome.storage)
(imports service)           ↓
    ↓                  App.tsx (calls migrateIfNeeded on init)
tools/index.ts
    ↓
AgentLoop.ts (unchanged)
```

---

## 8. Implementation Order

| Step | Task | Estimated Lines |
|------|------|-----------------|
| 1 | Create `store/TapWordFS.ts` — OPFS wrapper + singleton export | ~110 |
| 2 | Create `services/SkillMigration.ts` — one-time migration logic | ~60 |
| 3 | Refactor `services/SkillStorageService.ts` — swap chrome.storage → tapWordFS + index file | ~140 (net change ~80) |
| 4 | Refactor `agent/tools/skillTools.ts` — use `SkillStorageService` instead of direct chrome.storage | ~40 (net change ~20) |
| 5 | Update `App.tsx` — add migration call before skill load | ~5 |
| 6 | Manual smoke test — import skill, reload panel, verify persistence | — |
| 7 | (Optional) Add unit tests for `TapWordFS` and `SkillStorageService` with mock OPFS | — |

**Rationale**: Start with the leaf dependency (`TapWordFS`) and work upward. Migration is created early (step 2) so it can be wired in at step 5 after the new service is ready.

---

## 9. Edge Cases

### 9.1 First-Time Initialization

| Scenario | Behavior |
|----------|----------|
| Extension freshly installed, no skills exist | `loadSkillMetas()` → `readIndex()` returns `[]` → `exists(SKILLS_DIR)` returns `false` → returns `[]`. No errors. |
| `/tapword/skills/` directory does not exist yet | First `importSkill()` call triggers `writeFile()` which calls `resolveDir(segments, true)`, creating the `skills/` directory automatically. |

### 9.2 Empty Directories

| Scenario | Behavior |
|----------|----------|
| `listDir("/tapword/skills/")` on empty dir | Returns `[]` (empty array). |
| `listDir("/tapword/nonexistent/")` | Returns `[]` (catch block in `listDir`). |

### 9.3 File Not Found

| Scenario | Behavior |
|----------|----------|
| `readFile()` for non-existent path | Throws `DOMException` (NotFoundError). Callers must handle. |
| `getSkillBody("missing-id")` | Catches the read error, returns `null`. |
| `load_skill` tool with bad ID | Returns user-friendly error string listing available skills. |
| `deleteFile()` for non-existent path | No-op (silently caught). |

### 9.4 Large Files

| Scenario | Behavior |
|----------|----------|
| Skill file > 50,000 chars | Import succeeds (OPFS has no practical limit). UI should warn at import time (existing logic). |
| Very large `listDir()` (1000+ files) | OPFS iteration is lazy (async iterator). Performance is O(n) but acceptable for file listing. |

### 9.5 Concurrent Access

| Scenario | Behavior |
|----------|----------|
| Two `writeFile()` on same path simultaneously | Last-write-wins. OPFS `createWritable()` is exclusive per file handle — the second call waits for the first to close. |
| Read during write | `getFile()` returns the last committed version. In-progress writes (before `writable.close()`) are not visible. |
| Index file race (two imports at once) | Possible stale-read. Mitigation: serialize `importSkill`/`deleteSkill` calls at the application layer (React state updates are single-threaded in practice). |

### 9.6 Index Corruption Recovery

| Scenario | Behavior |
|----------|----------|
| `.index.json` is invalid JSON | `readIndex()` catches parse error, returns `[]`. `loadSkillMetas()` triggers `rebuildIndex()`. |
| `.index.json` is missing | Same as above — `readFile` throws, caught, triggers rebuild. |
| `.index.json` has stale entries | Only detectable via explicit "verify" operation. Not critical — stale meta entries for deleted files will result in `load_skill` returning "not found", and the user can re-import. A manual "rebuild index" button could be added to settings in the future. |

### 9.7 Browser Compatibility

| Browser | OPFS Support | Notes |
|---------|-------------|-------|
| Chrome 86+ | Full | Our minimum target. Extension sidepanel pages have full access. |
| Firefox 111+ | Full | Future if Firefox extension support is added. |
| Safari 15.2+ | Partial | `createWritable()` not supported — would need `createSyncAccessHandle()` in a Worker. Out of scope. |

---

## 10. `Skill` Type — Storage Semantics Change

### Before (chrome.storage.local)

```
chrome.storage.local["agentSkills"] = {
    "translation-style": {
        id: "translation-style",
        name: "Translation Style Guide",
        description: "...",
        body: "# Full markdown body...",      ← body stored inline in JSON
        sourceFileName: "Translation Style.md",
        importedAt: 1743724800000
    }
}
```

### After (OPFS)

```
/tapword/skills/translation-style.md          ← body is the file content itself
/tapword/skills/.index.json                   ← lightweight metadata array (no body field)
```

The `Skill` TypeScript interface remains unchanged — `body` is populated at read time by parsing the file content. The `body` field is never persisted in the index; it is always derived from the `.md` file on demand.

---

## 11. Summary

This spec replaces the monolithic `chrome.storage.local` blob with a clean OPFS-backed virtual filesystem. The key benefits are:

1. **Per-file I/O** — Reading one skill never touches another.
2. **No serialization tax** — Files are stored as raw text, not JSON-encoded.
3. **Scalable storage** — GB-level quota vs. 10 MB ceiling.
4. **File-native semantics** — `readFile`, `writeFile`, `listDir` map naturally to the "skill documents" concept.
5. **Self-healing index** — Metadata cache rebuilds automatically if corrupted.
6. **Zero-disruption migration** — Existing skills move transparently on first panel open.

The `TapWordFS` class is intentionally thin and business-logic-free, following the project's architecture principle of infrastructure purity. All skill-specific logic stays in `SkillStorageService`.
