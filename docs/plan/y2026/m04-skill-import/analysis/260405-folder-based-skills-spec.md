# Folder-Based Skills Support — Technical Specification

**Date**: 2026-04-05  
**Module**: `src/13_sidepanel`  
**Status**: Design finalized, pending implementation

---

## 1. Background

Skills are currently stored as single `.md` files in OPFS at `/tapword/skills/{id}.md`. The reference skill structure (see `docs/skills/`) shows that skills can also be **folders** containing:

- `SKILL.md` — entry point with YAML frontmatter (`name`, `description`) and body
- Sub-files / sub-folders (e.g., `references/project-review-checklist.md`, `agents/openai.yaml`)

Sub-files are referenced as natural-language instructions within the `SKILL.md` body (e.g., "Read `references/project-review-checklist.md`"). The agent uses the `load_skill` tool to retrieve content at runtime.

**Example reference folder skill** (`docs/skills/project-review-expert/`):

```
project-review-expert/
├── SKILL.md
├── agents/
│   └── openai.yaml
└── references/
    ├── extension-runtime-and-page-checklist.md
    ├── project-review-checklist.md
    └── repo-conventions-checklist.md
```

---

## 2. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | **Dual-mode storage** — both flat `.md` files and skill folders (`{id}/SKILL.md`) work simultaneously | No forced migration; backward compatible |
| 2 | **Storage layout** — folder skills stored at `/tapword/skills/{id}/SKILL.md` + sub-files | Mirrors the reference structure in `docs/skills/` |
| 3 | **Three-layer loading** — Layer 1 = metadata in system prompt (unchanged); Layer 2 = `load_skill` returns SKILL.md body + file listing; Layer 2.5 = `load_skill` with `file_path` returns sub-file | Minimal tool surface; agent discovers sub-files naturally |
| 4 | **Import UX** — `<input webkitdirectory>` for folder import; keep existing single-file import | Native browser API, no dependencies |
| 5 | **Index stores file manifest** — `.index.json` `SkillMeta` gains `type` and `files` fields | Avoids OPFS scanning on every read |
| 6 | **TapWordFS additions** — `deleteDir()` and `listDirRecursive()` | Required for folder lifecycle management |
| 7 | **Backward compatible** — existing flat skills keep working; `rebuildIndex()` detects both types | Zero-migration upgrade path |
| 8 | **Extend `load_skill` tool** — add optional `file_path` parameter instead of new tool | Keeps tool registry minimal |

---

## 3. Data Model Changes

### 3.1 `Skill` Interface

**Before** (`src/13_sidepanel/types.ts`):

```typescript
export interface Skill {
    id: string
    name: string
    description: string
    body: string
    sourceFileName: string
    importedAt: number
    enabled: boolean
}

export type SkillMeta = Pick<Skill, "id" | "name" | "description" | "sourceFileName" | "importedAt" | "enabled">
```

**After**:

```typescript
export interface Skill {
    id: string
    name: string
    description: string
    body: string
    sourceFileName: string
    importedAt: number
    enabled: boolean
    /** "file" for flat .md skills, "folder" for directory-based skills. */
    type: "file" | "folder"
    /** Relative paths of sub-files (folder skills only). Excludes SKILL.md itself. */
    files?: string[]
}

export type SkillMeta = Pick<
    Skill,
    "id" | "name" | "description" | "sourceFileName" | "importedAt" | "enabled" | "type" | "files"
>
```

### 3.2 Key Notes

- `type` defaults to `"file"` for all existing skills (backward compat via `?? "file"` wherever read).
- `files` is only populated for `type: "folder"`. Contains paths relative to the skill root (e.g., `["references/project-review-checklist.md", "agents/openai.yaml"]`).
- `sourceFileName` for folder skills is the folder name (e.g., `"project-review-expert"`).

---

## 4. Storage Layout

### 4.1 Current Layout (flat files only)

```
/tapword/skills/
├── .index.json
├── translation-style.md
└── code-review.md
```

### 4.2 New Layout (dual-mode)

```
/tapword/skills/
├── .index.json                                         # Updated schema
├── translation-style.md                                # Flat skill (unchanged)
├── code-review.md                                      # Flat skill (unchanged)
└── project-review-expert/                              # Folder skill
    ├── SKILL.md                                        # Entry point
    ├── agents/
    │   └── openai.yaml
    └── references/
        ├── extension-runtime-and-page-checklist.md
        ├── project-review-checklist.md
        └── repo-conventions-checklist.md
```

### 4.3 Updated `.index.json` Schema

```jsonc
[
    {
        "id": "translation-style",
        "name": "Translation Style",
        "description": "Guidelines for translation tone and accuracy.",
        "sourceFileName": "translation-style.md",
        "importedAt": 1712345678000,
        "enabled": true,
        "type": "file"
        // no "files" field for flat skills
    },
    {
        "id": "project-review-expert",
        "name": "Project Review Expert",
        "description": "Comprehensive project review skill with checklists.",
        "sourceFileName": "project-review-expert",
        "importedAt": 1712345999000,
        "enabled": true,
        "type": "folder",
        "files": [
            "agents/openai.yaml",
            "references/extension-runtime-and-page-checklist.md",
            "references/project-review-checklist.md",
            "references/repo-conventions-checklist.md"
        ]
    }
]
```

---

## 5. TapWordFS Changes

File: `src/13_sidepanel/services/TapWordFS.ts`

### 5.1 New Method: `deleteDir`

```typescript
/** Delete a directory and all its contents recursively. */
async deleteDir(path: string): Promise<void> {
    const { segments, name } = this.parsePath(path)
    try {
        const parentDir = await this.resolveDir(segments, false)
        await parentDir.removeEntry(name, { recursive: true })
        logger.info(`Deleted directory ${path}`)
    } catch {
        // Directory does not exist — treat as no-op
    }
}
```

### 5.2 New Method: `listDirRecursive`

```typescript
/** Recursively list all entries under a directory, returning relative paths. */
async listDirRecursive(path: string): Promise<Array<{ relativePath: string; kind: "file" | "directory" }>> {
    const results: Array<{ relativePath: string; kind: "file" | "directory" }> = []

    async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
        for await (const [name, handle] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
            const rel = prefix ? `${prefix}/${name}` : name
            const kind = handle.kind as "file" | "directory"
            results.push({ relativePath: rel, kind })
            if (kind === "directory") {
                await walk(handle as FileSystemDirectoryHandle, rel)
            }
        }
    }

    // Resolve the target directory
    const normalizedPath = path.endsWith("/") ? path : path + "/"
    if (!normalizedPath.startsWith(PATH_PREFIX)) {
        throw new Error(`Invalid path: must start with ${PATH_PREFIX}`)
    }
    const relative = normalizedPath.slice(PATH_PREFIX.length).replace(/\/+$/, "")
    const segments = relative ? relative.split("/").filter(Boolean) : []

    try {
        const dir = await this.resolveDir(segments, false)
        await walk(dir, "")
    } catch {
        // Directory does not exist — return empty
    }
    return results
}
```

### 5.3 Updated `ITapWordFS` Interface

```typescript
export interface ITapWordFS {
    readFile(path: string): Promise<string>
    writeFile(path: string, content: string): Promise<void>
    deleteFile(path: string): Promise<void>
    deleteDir(path: string): Promise<void>                                          // NEW
    listDir(path: string): Promise<DirEntry[]>
    listDirRecursive(path: string): Promise<Array<{ relativePath: string; kind: string }>>  // NEW
    exists(path: string): Promise<boolean>
    stat(path: string): Promise<FileStat>
}
```

---

## 6. SkillStorageService Changes

File: `src/13_sidepanel/services/SkillStorageService.ts`

### 6.1 Updated `ISkillStorageService` Interface

```typescript
export interface ISkillStorageService {
    loadSkillMetas(): Promise<SkillMeta[]>
    importSkill(fileName: string, fileContent: string): Promise<Skill>
    importSkillFolder(folderName: string, files: Array<{ relativePath: string; content: string }>): Promise<Skill>  // NEW
    deleteSkill(skillId: string): Promise<void>       // Updated: handles both types
    getSkillBody(skillId: string): Promise<string | null>  // Updated: dispatches by type
    getSkillFile(skillId: string, relativePath: string): Promise<string | null>  // NEW
    listSkillFiles(skillId: string): Promise<string[]>     // NEW
    loadAllSkills(): Promise<Record<string, Skill>>
    toggleSkillEnabled(skillId: string, enabled: boolean): Promise<void>
}
```

### 6.2 `importSkill` (unchanged for flat files)

No changes. Continues to write `{id}.md` and index with `type: "file"` (newly added default).

The only adjustment is adding `type: "file"` to the `SkillMeta` written to the index:

```typescript
const meta: SkillMeta = {
    id,
    name,
    description,
    sourceFileName: fileName,
    importedAt: Date.now(),
    enabled: true,
    type: "file",  // NEW — explicit type marker
}
```

### 6.3 New: `importSkillFolder`

```typescript
export async function importSkillFolder(
    folderName: string,
    files: Array<{ relativePath: string; content: string }>
): Promise<Skill> {
    const id = fileNameToId(folderName)
    const skillDir = `${SKILLS_DIR}/${id}`

    // Find SKILL.md — expect at root of the provided file list
    const skillMdEntry = files.find((f) => f.relativePath === "SKILL.md")
        ?? files.find((f) => f.relativePath.endsWith("/SKILL.md"))
    if (!skillMdEntry) {
        throw new Error("Folder must contain a SKILL.md file at the root.")
    }

    // Write all files to OPFS
    for (const file of files) {
        await tapWordFS.writeFile(`${skillDir}/${file.relativePath}`, file.content)
    }

    // Parse SKILL.md frontmatter
    const { name, description, body } = parseSkillFile(skillMdEntry.content, folderName)

    // Build sub-file listing (exclude SKILL.md itself)
    const subFiles = files
        .filter((f) => f.relativePath !== "SKILL.md")
        .map((f) => f.relativePath)

    // Update index
    const metas = await readIndex()
    const meta: SkillMeta = {
        id,
        name,
        description,
        sourceFileName: folderName,
        importedAt: Date.now(),
        enabled: true,
        type: "folder",
        files: subFiles,
    }
    const updated = metas.filter((m) => m.id !== id)
    updated.push(meta)
    await writeIndex(updated)

    logger.info(`Imported folder skill '${id}' with ${files.length} files`)
    return { id, name, description, body, sourceFileName: folderName, importedAt: meta.importedAt, enabled: true, type: "folder", files: subFiles }
}
```

### 6.4 `deleteSkill` (updated — type dispatch)

```typescript
export async function deleteSkill(skillId: string): Promise<void> {
    const metas = await readIndex()
    const meta = metas.find((m) => m.id === skillId)
    const type = meta?.type ?? "file"

    if (type === "folder") {
        await tapWordFS.deleteDir(`${SKILLS_DIR}/${skillId}`)
    } else {
        await tapWordFS.deleteFile(`${SKILLS_DIR}/${skillId}.md`)
    }

    await writeIndex(metas.filter((m) => m.id !== skillId))
    logger.info(`Deleted skill '${skillId}' (type=${type})`)
}
```

### 6.5 `getSkillBody` (updated — type dispatch)

```typescript
export async function getSkillBody(skillId: string): Promise<string | null> {
    const metas = await readIndex()
    const meta = metas.find((m) => m.id === skillId)
    const type = meta?.type ?? "file"

    try {
        const filePath = type === "folder"
            ? `${SKILLS_DIR}/${skillId}/SKILL.md`
            : `${SKILLS_DIR}/${skillId}.md`
        const content = await tapWordFS.readFile(filePath)
        const { body } = parseSkillFile(content, `${skillId}.md`)
        return body
    } catch {
        return null
    }
}
```

### 6.6 New: `getSkillFile`

```typescript
export async function getSkillFile(skillId: string, relativePath: string): Promise<string | null> {
    try {
        return await tapWordFS.readFile(`${SKILLS_DIR}/${skillId}/${relativePath}`)
    } catch {
        return null
    }
}
```

### 6.7 New: `listSkillFiles`

```typescript
export async function listSkillFiles(skillId: string): Promise<string[]> {
    const metas = await readIndex()
    const meta = metas.find((m) => m.id === skillId)
    if (meta?.files) return meta.files

    // Fallback: scan OPFS if index doesn't have file list
    const entries = await tapWordFS.listDirRecursive(`${SKILLS_DIR}/${skillId}`)
    return entries
        .filter((e) => e.kind === "file" && e.relativePath !== "SKILL.md")
        .map((e) => e.relativePath)
}
```

### 6.8 `rebuildIndex` (updated — detect both types)

```typescript
async function rebuildIndex(): Promise<SkillMeta[]> {
    logger.info("Rebuilding skill index from filesystem...")
    const entries = await tapWordFS.listDir(SKILLS_DIR)
    const metas: SkillMeta[] = []

    for (const entry of entries) {
        if (entry.name.startsWith(".")) continue

        if (entry.kind === "file" && entry.name.endsWith(".md")) {
            // ── Flat skill ──
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
                    enabled: true,
                    type: "file",
                })
            } catch (err) {
                logger.warn(`Failed to read skill file ${entry.name}:`, err)
            }
        } else if (entry.kind === "directory") {
            // ── Folder skill — check for SKILL.md inside ──
            try {
                const skillMdPath = `${SKILLS_DIR}/${entry.name}/SKILL.md`
                const content = await tapWordFS.readFile(skillMdPath)
                const { name, description } = parseSkillFile(content, entry.name)
                const stat = await tapWordFS.stat(skillMdPath)

                // Scan sub-files
                const subEntries = await tapWordFS.listDirRecursive(`${SKILLS_DIR}/${entry.name}`)
                const subFiles = subEntries
                    .filter((e) => e.kind === "file" && e.relativePath !== "SKILL.md")
                    .map((e) => e.relativePath)

                metas.push({
                    id: entry.name,
                    name,
                    description,
                    sourceFileName: entry.name,
                    importedAt: stat.lastModified,
                    enabled: true,
                    type: "folder",
                    files: subFiles,
                })
            } catch {
                logger.warn(`Directory '${entry.name}' has no SKILL.md — skipping`)
            }
        }
    }

    await writeIndex(metas)
    logger.info(`Index rebuilt with ${metas.length} skills (flat + folder)`)
    return metas
}
```

### 6.9 `toggleSkillEnabled` — unchanged

No changes needed. Operates purely on index metadata.

---

## 7. Agent Tool Changes

File: `src/13_sidepanel/agent/tools/skillTools.ts`

### 7.1 Updated `load_skill` Tool Definition

```typescript
export const loadSkillTool: ToolRegistration = {
    definition: {
        name: "load_skill",
        description:
            "Load the full content of a specialized skill document by its ID. " +
            "Use this tool when you need detailed instructions or domain knowledge " +
            "listed in the 'Skills available' section of your instructions. " +
            "For folder-based skills, this returns the main SKILL.md body plus a listing of available sub-files. " +
            "To read a specific sub-file, provide the optional file_path parameter.",
        input_schema: {
            type: "object" as const,
            properties: {
                skill_id: {
                    type: "string",
                    description: "The skill identifier (e.g., 'project-review-expert').",
                },
                file_path: {
                    type: "string",
                    description:
                        "Optional. Relative path to a sub-file within a folder skill " +
                        "(e.g., 'references/project-review-checklist.md'). " +
                        "Only applicable for folder-based skills.",
                },
            },
            required: ["skill_id"],
        },
    },
    label: "Loading skill...",
    execute: async (input: Record<string, unknown>): Promise<string> => {
        const skillId = input.skill_id as string
        const filePath = input.file_path as string | undefined
        if (!skillId) {
            throw new Error("skill_id is required")
        }

        // Check enabled status
        const metas = await SkillStorageService.loadSkillMetas()
        const meta = metas.find((m) => m.id === skillId)

        if (meta && !meta.enabled) {
            logger.warn(`Skill '${skillId}' is disabled`)
            return `Error: Skill '${skillId}' is currently disabled.`
        }

        // ── Layer 2.5: specific sub-file requested ──
        if (filePath) {
            const content = await SkillStorageService.getSkillFile(skillId, filePath)
            if (!content) {
                return `Error: File '${filePath}' not found in skill '${skillId}'.`
            }
            logger.info(`Loaded sub-file '${filePath}' from skill '${skillId}': ${content.length} chars`)
            return `<skill_file skill="${skillId}" path="${filePath}">\n${content}\n</skill_file>`
        }

        // ── Layer 2: main skill body ──
        const body = await SkillStorageService.getSkillBody(skillId)
        if (!body) {
            const available = metas.filter((m) => m.enabled).map((m) => m.id).join(", ")
            logger.warn(`Skill not found: ${skillId}. Available: ${available}`)
            return `Error: Unknown skill '${skillId}'. Available skills: ${available || "(none)"}`
        }

        const name = meta?.name ?? skillId
        let result = `<skill name="${name}">\n${body}\n</skill>`

        // For folder skills, append available sub-files listing
        if (meta?.type === "folder" && meta.files && meta.files.length > 0) {
            const fileList = meta.files.map((f) => `  - ${f}`).join("\n")
            result += `\n\n<skill_files skill="${skillId}">\nAvailable sub-files (use load_skill with file_path to read):\n${fileList}\n</skill_files>`
        }

        logger.info(`Loaded skill '${skillId}': ${body.length} chars`)
        return result
    },
}
```

---

## 8. System Prompt Changes

File: `src/13_sidepanel/agent/prompts.ts`

**No changes needed.** The `buildSystemPrompt()` function performs Layer 1 injection using `SkillMeta.id` and `SkillMeta.description`. Both flat and folder skills have these fields, so the existing logic works as-is.

---

## 9. UI Changes

### 9.1 SkillsPanel.tsx

File: `src/13_sidepanel/components/SkillsPanel.tsx`

#### 9.1.1 Updated Props

```typescript
interface SkillsPanelProps {
    skills: SkillMeta[]
    onImportSkill: (fileName: string, content: string) => void
    onImportSkillFolder: (folderName: string, files: Array<{ relativePath: string; content: string }>) => void  // NEW
    onDeleteSkill: (skillId: string) => void
    onToggleSkill: (skillId: string, enabled: boolean) => void
}
```

#### 9.1.2 Folder Import Handler

Add a second `<input>` with `webkitdirectory` attribute and a new handler:

```typescript
const folderInputRef = useRef<HTMLInputElement>(null)

async function handleFolderImport(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return

    // Derive folder name from the first file's webkitRelativePath
    const firstPath = fileList[0].webkitRelativePath
    const folderName = firstPath.split("/")[0]

    // Read all files and build the array
    const files: Array<{ relativePath: string; content: string }> = []
    for (const file of Array.from(fileList)) {
        // webkitRelativePath = "folderName/SKILL.md" or "folderName/refs/foo.md"
        const relativePath = file.webkitRelativePath.slice(folderName.length + 1) // strip "folderName/"
        const content = await file.text()
        files.push({ relativePath, content })
    }

    // Validate SKILL.md exists
    if (!files.some((f) => f.relativePath === "SKILL.md")) {
        alert("Selected folder must contain a SKILL.md file at the root.")
        return
    }

    onImportSkillFolder(folderName, files)
    event.target.value = ""
}
```

#### 9.1.3 Import Button Area

Add a second button next to the existing "Import" button:

```tsx
<div className="p-3 border-b border-stone-200 flex gap-2">
    {/* Single file import */}
    <button
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors"
        onClick={() => fileInputRef.current?.click()}
    >
        <Upload className="w-3.5 h-3.5" />
        {i18nModule.translate("sidepanel.skills.import")}
    </button>
    <input ref={fileInputRef} type="file" accept=".md,.txt" className="hidden" onChange={handleFileImport} />

    {/* Folder import */}
    <button
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-stone-100 hover:bg-stone-200 text-stone-600 text-xs font-medium transition-colors"
        onClick={() => folderInputRef.current?.click()}
    >
        <FolderUp className="w-3.5 h-3.5" />
        {i18nModule.translate("sidepanel.skills.importFolder")}
    </button>
    <input ref={folderInputRef} type="file" className="hidden" onChange={handleFolderImport}
        {...{ webkitdirectory: "", directory: "" } as any} />
</div>
```

> Note: `webkitdirectory` attribute requires a type assertion due to React's strict HTML attribute typing.

#### 9.1.4 Skill Card Type Indicator

Add a visual indicator for folder vs. file skills:

```tsx
import { File, FolderOpen, FolderUp } from "lucide-react"

// Inside skill card, next to the name:
<span className="text-stone-400 shrink-0 mr-1">
    {skill.type === "folder" ? <FolderOpen className="w-3 h-3" /> : <File className="w-3 h-3" />}
</span>
```

#### 9.1.5 Preview for Folder Skills

When expanded, folder skills show SKILL.md body **plus** a list of sub-files:

```tsx
{expandedId === skill.id && (
    <div className="border-t border-stone-100 px-3 py-2">
        {loadingBodyId === skill.id ? (
            <Loader2 className="w-4 h-4 text-stone-400 animate-spin" />
        ) : (
            <>
                <pre
                    className="text-[11px] text-stone-600 whitespace-pre-wrap break-words overflow-y-auto font-mono leading-relaxed"
                    style={{ maxHeight: PREVIEW_MAX_HEIGHT }}
                >
                    {bodyCache[skill.id]}
                </pre>
                {skill.type === "folder" && skill.files && skill.files.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-stone-100">
                        <p className="text-[10px] text-stone-400 font-medium mb-1">Sub-files:</p>
                        <ul className="text-[10px] text-stone-500 space-y-0.5">
                            {skill.files.map((f) => (
                                <li key={f} className="font-mono truncate">📄 {f}</li>
                            ))}
                        </ul>
                    </div>
                )}
            </>
        )}
    </div>
)}
```

---

## 10. App.tsx Changes

File: `src/13_sidepanel/App.tsx`

### 10.1 New Handler

```typescript
const handleImportSkillFolder = async (
    folderName: string,
    files: Array<{ relativePath: string; content: string }>
) => {
    const skill = await skillStorageService.importSkillFolder(folderName, files)
    setSkills((prev) => [...prev.filter((s) => s.id !== skill.id), skill])
}
```

### 10.2 Updated SkillsPanel Props

```tsx
<SkillsPanel
    skills={skills}
    onImportSkill={handleImportSkill}
    onImportSkillFolder={handleImportSkillFolder}   // NEW
    onDeleteSkill={handleDeleteSkill}
    onToggleSkill={handleToggleSkill}
/>
```

---

## 11. Verification Plan

| # | Scenario | Expected Result |
|---|----------|-----------------|
| 1 | Type-check passes | `npm run type-check` exits with 0 errors |
| 2 | Flat skill import | Works identically to current behavior; index entry has `type: "file"` |
| 3 | Folder skill import | Creates correct OPFS directory structure; SKILL.md + all sub-files written |
| 4 | `load_skill` (folder, no `file_path`) | Returns SKILL.md body + appended sub-file listing |
| 5 | `load_skill` (folder, with `file_path`) | Returns specific sub-file content |
| 6 | `load_skill` (flat skill) | Unchanged behavior — returns body only, no file listing |
| 7 | Delete folder skill | Entire directory removed from OPFS via `deleteDir` |
| 8 | Delete flat skill | Unchanged — single `.md` file removed |
| 9 | `rebuildIndex()` | Detects both `.md` files and directories with `SKILL.md`; builds correct index |
| 10 | Enable/disable | Works for both types; toggles `enabled` in index only |
| 11 | Preview folder skill | Shows SKILL.md body + sub-file listing in UI |
| 12 | Import folder without SKILL.md | Shows validation error, import aborted |
| 13 | Re-import same folder skill | Overwrites existing; index updated with fresh metadata |

---

## 12. File Change Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/13_sidepanel/types.ts` | Modified | Add `type` and `files` fields to `Skill` and `SkillMeta` |
| `src/13_sidepanel/services/TapWordFS.ts` | Modified | Add `deleteDir()`, `listDirRecursive()`, update `ITapWordFS` |
| `src/13_sidepanel/services/SkillStorageService.ts` | Modified | Add `importSkillFolder()`, `getSkillFile()`, `listSkillFiles()`; update `deleteSkill()`, `getSkillBody()`, `rebuildIndex()`, `ISkillStorageService` |
| `src/13_sidepanel/agent/tools/skillTools.ts` | Modified | Add `file_path` param to `load_skill` tool; handle Layer 2.5 loading |
| `src/13_sidepanel/agent/prompts.ts` | None | No changes needed |
| `src/13_sidepanel/components/SkillsPanel.tsx` | Modified | Add folder import button/handler; type indicator icon; sub-file listing in preview |
| `src/13_sidepanel/App.tsx` | Modified | Add `handleImportSkillFolder` handler; pass to SkillsPanel |
| `src/0_common/locales/*/messages.json` | Modified | Add `sidepanel.skills.importFolder` i18n key |
