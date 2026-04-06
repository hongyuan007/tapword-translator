# Folder-Based Skill Import — Technical Redesign Specification

**Date**: 2026-07-14  
**Status**: Draft  
**Module**: `src/13_sidepanel`  
**Prerequisite**: Original single-file skill import (260404-skill-import-spec)

---

## 1. Motivation

The current skill system stores each skill as a single `.md` file at `/tapword/skills/{id}.md`. While sufficient for simple text documents, this model breaks down when skills need to include supplementary resources — example code, fixture data, sub-documents, or templates. The LLM cannot discover or read these companion files because they don't exist in the virtual filesystem.

### Goals

1. **Folder-per-skill**: Each skill is an entire folder whose name serves as the skill ID.
2. **Multi-file support**: Skill authors can bundle any number of sub-files alongside the entry document.
3. **LLM discoverability**: The `load_skill` response exposes a file listing so the LLM knows what supplementary files exist.
4. **`read_file` tool**: A new tool lets the LLM read any file from the virtual filesystem on demand.
5. **Folder import UX**: Users select a folder (not a single file) to import.

### Non-Goals

- Skill editing inside the side panel (future work).
- Drag-and-drop import (future work).
- Nested skill folders (skills within skills).

---

## 2. Current State

### 2.1 Storage Layout (Current)

```
/tapword/skills/.index.json          ← metadata index
/tapword/skills/{id}.md              ← one file per skill (flat)
```

### 2.2 Types (Current — `types.ts`)

```typescript
interface Skill {
    id: string
    name: string
    description: string
    body: string
    sourceFileName: string       // ← tied to single-file model
    importedAt: number
    enabled: boolean
}

type SkillMeta = Pick<Skill, "id" | "name" | "description" | "sourceFileName" | "importedAt" | "enabled">
```

### 2.3 SkillStorageService (Current)

| Method | Signature | What it does |
|--------|-----------|--------------|
| `importSkill` | `(fileName: string, fileContent: string) → Skill` | Derives ID from filename, writes single `.md` file, updates index |
| `deleteSkill` | `(skillId: string) → void` | Deletes single `.md` file, updates index |
| `getSkillBody` | `(skillId: string) → string \| null` | Reads `{id}.md`, parses frontmatter, returns body |
| `loadSkillMetas` | `() → SkillMeta[]` | Reads `.index.json` (self-heals by scanning files) |
| `rebuildIndex` | (internal) | Scans `*.md` files in skills dir |

### 2.4 TapWordFS (Current)

OPFS-backed virtual filesystem scoped under `/tapword/`. Supports: `readFile`, `writeFile`, `deleteFile`, `listDir`, `exists`, `stat`. All directory creation is implicit via `resolveDir(segments, create=true)`. **Missing**: recursive directory deletion (`deleteDir`).

### 2.5 skillTools.ts (Current)

Single tool: `load_skill`. Returns `<skill name="...">` body XML. No file listing, no folder path.

### 2.6 SkillsPanel.tsx (Current)

File input: `<input type="file" accept=".md,.txt">`. Imports one file at a time. Calls `onImportSkill(fileName, content)`.

### 2.7 prompts.ts (Current)

`buildSystemPrompt(skills)` lists skills as:
```
  - {id}: {description}
```
No folder path information.

---

## 3. Proposed Storage Layout

```
/tapword/skills/.index.json                     ← skill metadata index (updated)
/tapword/skills/{folder-name}/                   ← one folder per skill
  SKILL.md                                       ← entry document (required, has frontmatter)
  examples/                                      ← optional sub-files/folders
    login.spec.ts
  fixtures/
    auth.json
  ...
```

**Key rules**:
- The folder name IS the skill ID (sanitized: lowercase, alphanumeric + hyphens).
- `SKILL.md` must exist in every skill folder. It is the entry document.
- All other files/folders within the skill folder are supplementary.

---

## 4. Data Model Changes

### 4.1 `types.ts` — Updated Interfaces

```typescript
/** A single imported skill (folder-based). */
interface Skill {
    /** Unique identifier = sanitized folder name (e.g., "e2e-testing"). */
    id: string
    /** Human-readable name from SKILL.md frontmatter or folder name. */
    name: string
    /** Short description for Layer 1 injection (~10-20 words). */
    description: string
    /**
     * Full markdown body of SKILL.md (Layer 2 content, excluding frontmatter).
     * Populated on demand for preview; may be empty in list context.
     */
    body: string
    /** Folder name as imported (e.g., "e2e-testing"). */
    folderName: string                              // NEW — replaces sourceFileName
    /** Import timestamp (epoch ms). */
    importedAt: number
    /** Whether this skill is enabled for agent use. */
    enabled: boolean
}

/** Metadata-only projection used for Layer 1 injection, UI listing, and LLM discovery. */
type SkillMeta = Pick<Skill, "id" | "name" | "description" | "folderName" | "importedAt" | "enabled"> & {
    /** Absolute virtual FS path to the skill folder (e.g., "/tapword/skills/e2e-testing"). */
    folderPath: string                              // NEW
    /**
     * List of all file paths relative to the skill folder.
     * e.g., ["SKILL.md", "examples/login.spec.ts", "fixtures/auth.json"]
     */
    files: string[]                                 // NEW
}
```

**Migration note**: `sourceFileName` is removed from both `Skill` and `SkillMeta`. Any code referencing it must be updated to use `folderName`.

### 4.2 `.index.json` Schema (Updated)

```json
[
    {
        "id": "e2e-testing",
        "name": "E2E Testing Guide",
        "description": "Guide for Playwright E2E tests...",
        "folderName": "e2e-testing",
        "folderPath": "/tapword/skills/e2e-testing",
        "files": ["SKILL.md", "examples/login.spec.ts"],
        "importedAt": 1720000000000,
        "enabled": true
    }
]
```

---

## 5. File-by-File Changes

### 5.1 `services/TapWordFS.ts` — Add `deleteDir`

**Change type**: Modify (add method)

Add a new method to the `ITapWordFS` interface and `TapWordFS` class:

```typescript
/** Recursively delete a directory and all its contents. */
deleteDir(path: string): Promise<void>
```

**Implementation approach**: Use `resolveDir` to get the parent directory handle, then call `removeEntry(name, { recursive: true })` which is supported by OPFS.

**Why not just `deleteFile`**: OPFS `removeEntry` without `{ recursive: true }` fails on non-empty directories. The new method must pass the recursive flag.

---

### 5.2 `services/SkillStorageService.ts` — Folder-Aware CRUD

**Change type**: Major rewrite

#### Removed

| Item | Reason |
|------|--------|
| `fileNameToId()` | ID is now the folder name directly (sanitized). Replaced by a simpler `sanitizeFolderName()`. |

#### Modified Methods

| Method | Old Signature | New Signature | Changes |
|--------|---------------|---------------|---------|
| `importSkill` | `(fileName: string, fileContent: string)` | `(folderName: string, files: Array<{relativePath: string, content: string}>)` | Accepts pre-read file list from UI. Validates `SKILL.md` exists. Writes all files to `/tapword/skills/{folderName}/`. Parses `SKILL.md` frontmatter. Updates index with full file listing. |
| `deleteSkill` | Deletes single `{id}.md` | Calls `tapWordFS.deleteDir(folderPath)` | Recursively deletes entire skill folder + updates index. |
| `getSkillBody` | Reads `{id}.md` | Reads `{id}/SKILL.md` | Path changes from flat file to nested entry document. |
| `rebuildIndex` | Scans `*.md` files | Scans subdirectories, reads `SKILL.md` in each | Iterates directory entries where `kind === "directory"`, reads `SKILL.md` from each, collects file list recursively. |
| `loadSkillMetas` | No change in signature | Same | Self-healing logic now rebuilds from folders instead of flat files. |

#### New Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `getSkillFiles` | `(skillId: string) → Promise<string[]>` | Recursively lists all files in the skill folder, returning paths relative to the skill root (e.g., `["SKILL.md", "examples/login.spec.ts"]`). |
| `readSkillFile` | `(skillId: string, relativePath: string) → Promise<string>` | Reads an arbitrary file from a skill folder. Used by the `read_file` tool. |

#### Helper Changes

| Helper | Change |
|--------|--------|
| `sanitizeFolderName(name: string): string` | New. Lowercases, replaces non-alphanumeric chars with hyphens, trims leading/trailing hyphens. |
| `listFilesRecursive(dirPath: string, prefix: string): Promise<string[]>` | New internal helper. Walks the OPFS directory tree under a skill folder and returns a flat list of relative paths. |
| `parseSkillFile` | No change (still parses frontmatter from markdown content). |

#### Import Validation

`importSkill` must validate:
1. `files` array is non-empty.
2. At least one file has `relativePath === "SKILL.md"`.
3. `folderName` is not empty after sanitization.
4. Throw descriptive error if validation fails (UI should display this).

---

### 5.3 `agent/tools/skillTools.ts` — Enhanced `load_skill` Response

**Change type**: Modify

The `load_skill` tool response format changes to include folder metadata:

**Current response**:
```xml
<skill name="E2E Testing Guide">
{SKILL.md body content}
</skill>
```

**New response**:
```xml
<skill name="E2E Testing Guide" path="/tapword/skills/e2e-testing/">
<files>
- SKILL.md
- examples/login.spec.ts
- fixtures/auth.json
</files>
<content>
{SKILL.md body content}
</content>
</skill>
```

**Implementation notes**:
- Fetch `SkillMeta` for the requested skill ID (already done for `enabled` check).
- Use `meta.folderPath` and `meta.files` to populate the `<files>` section.
- The `<content>` section contains the same body as before (parsed SKILL.md without frontmatter).
- The file listing tells the LLM what sub-files exist, which it can then read via the `read_file` tool.

---

### 5.4 `agent/tools/readFileTool.ts` — New File

**Change type**: New file

A new tool that allows the LLM to read any file from the TapWord virtual filesystem.

```
Tool name:    read_file
Input:        { path: string }  — absolute virtual FS path
Output:       file content as UTF-8 string
Error:        "File not found: {path}" if file does not exist
```

**Tool definition sketch**:

```typescript
export const readFileTool: ToolRegistration = {
    definition: {
        name: "read_file",
        description:
            "Read the content of a file from the TapWord virtual filesystem. " +
            "Use this to read supplementary files within a skill folder (e.g., examples, fixtures). " +
            "The path must be an absolute virtual FS path starting with /tapword/.",
        input_schema: {
            type: "object",
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
    execute: async (input) => {
        // Validate path starts with /tapword/
        // Use tapWordFS.readFile(path) to read
        // Return content as string, or error message
    },
}
```

**Security boundary**: The path MUST start with `/tapword/`. Reject any other paths.

---

### 5.5 `agent/tools/index.ts` — Register `readFileTool`

**Change type**: Modify

Add import and registration:
```typescript
import { readFileTool } from "./readFileTool"

// In TOOL_REGISTRY:
[readFileTool.definition.name, readFileTool],
```

---

### 5.6 `agent/prompts.ts` — Include Folder Path in Skill Listing

**Change type**: Modify

The skill lines in the system prompt should include the folder path so the LLM knows where files live:

**Current format**:
```
  - e2e-testing: Guide for Playwright E2E tests...
```

**New format**:
```
  - e2e-testing (/tapword/skills/e2e-testing/): Guide for Playwright E2E tests...
```

**Code change**:
```typescript
const skillLines = enabledSkills
    .map((s) => `  - ${s.id} (${s.folderPath}/): ${s.description}`)
    .join("\n")
```

Also update the skill section instructions to mention the `read_file` tool:
```
# Skills
You have access to specialized knowledge documents. Use the load_skill tool to load a skill's entry document. 
The response includes a file listing — use the read_file tool to access supplementary files (examples, fixtures, etc.).
```

---

### 5.7 `components/SkillsPanel.tsx` — Folder Import UI

**Change type**: Modify

#### File Input Change

Replace:
```tsx
<input type="file" accept=".md,.txt" ... />
```
With:
```tsx
<input type="file" webkitdirectory="" ... />
```

**TypeScript declaration**: The `webkitdirectory` attribute is non-standard. Add a JSX attribute declaration:
```typescript
// In types.ts or a dedicated .d.ts file:
declare namespace React {
    interface InputHTMLAttributes<T> {
        webkitdirectory?: string
        directory?: string
    }
}
```

#### Handler Change

Replace `handleFileImport` with `handleFolderImport`:

```typescript
async function handleFolderImport(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return

    // Extract folder name from the first file's webkitRelativePath
    // Format: "folder-name/SKILL.md" or "folder-name/sub/file.ts"
    const firstPath = fileList[0].webkitRelativePath
    const folderName = firstPath.split("/")[0]

    // Read all files and reconstruct relative paths
    const files: Array<{ relativePath: string; content: string }> = []
    for (const file of Array.from(fileList)) {
        const relativePath = file.webkitRelativePath.split("/").slice(1).join("/")
        const content = await file.text()
        files.push({ relativePath, content })
    }

    onImportSkill(folderName, files)
    event.target.value = ""
}
```

#### Props Change

```typescript
interface SkillsPanelProps {
    skills: SkillMeta[]
    onImportSkill: (folderName: string, files: Array<{relativePath: string, content: string}>) => void  // CHANGED
    onDeleteSkill: (skillId: string) => void
    onToggleSkill: (skillId: string, enabled: boolean) => void
}
```

#### Display Adjustments

- Replace any reference to `skill.sourceFileName` with `skill.folderName`.
- Optionally show file count (from `skill.files.length`) in the skill card.

---

### 5.8 `App.tsx` — Updated Import Handler

**Change type**: Modify

```typescript
// Old:
const handleImportSkill = async (fileName: string, content: string) => { ... }

// New:
const handleImportSkill = async (
    folderName: string,
    files: Array<{relativePath: string, content: string}>
) => {
    const skill = await skillStorageService.importSkill(folderName, files)
    setSkills((prev) => [...prev.filter((s) => s.id !== skill.id), skill])
}
```

The `SkillsPanel` prop type for `onImportSkill` must also match.

---

### 5.9 `types.ts` — Interface Updates

**Change type**: Modify (covered in §4.1)

Summary of field changes:

| Field | Before | After |
|-------|--------|-------|
| `Skill.sourceFileName` | `string` | **Removed** |
| `Skill.folderName` | — | `string` (NEW) |
| `SkillMeta.sourceFileName` | `string` | **Removed** |
| `SkillMeta.folderName` | — | `string` (NEW) |
| `SkillMeta.folderPath` | — | `string` (NEW) |
| `SkillMeta.files` | — | `string[]` (NEW) |

---

## 6. Import Flow (End-to-End)

```
User clicks [Import Skill] in SkillsPanel
    │
    ▼
<input type="file" webkitdirectory> opens native folder picker
    │
    ▼
User selects folder "e2e-testing/" containing:
    SKILL.md
    examples/login.spec.ts
    fixtures/auth.json
    │
    ▼
handleFolderImport() reads all files via FileReader:
    files = [
        { relativePath: "SKILL.md", content: "---\nname: ...\n---\n..." },
        { relativePath: "examples/login.spec.ts", content: "import ..." },
        { relativePath: "fixtures/auth.json", content: "{...}" },
    ]
    │
    ▼
App.handleImportSkill("e2e-testing", files)
    │
    ▼
SkillStorageService.importSkill("e2e-testing", files):
    1. sanitize folder name → "e2e-testing" (= skill ID)
    2. validate SKILL.md exists in files array
    3. parse SKILL.md frontmatter → { name, description }
    4. write all files to OPFS:
         /tapword/skills/e2e-testing/SKILL.md
         /tapword/skills/e2e-testing/examples/login.spec.ts
         /tapword/skills/e2e-testing/fixtures/auth.json
    5. build SkillMeta with files list
    6. update .index.json
    │
    ▼
UI state updates → skill card appears in SkillsPanel
    (shows "e2e-testing", 3 files)
```

---

## 7. Skill Usage Flow (Runtime)

```
User sends: "Write an E2E test for the login page"
    │
    ▼
AgentLoop loads skill metas → buildSystemPrompt(metas):
    "Available skills:
       - e2e-testing (/tapword/skills/e2e-testing/): Guide for Playwright E2E tests..."
    │
    ▼
LLM decides to load the skill
    │
    ▼
LLM tool_use: load_skill({ skill_id: "e2e-testing" })
    │
    ▼
loadSkillTool.execute():
    - reads SKILL.md body from OPFS
    - gets meta.folderPath, meta.files
    - returns:
        <skill name="E2E Testing Guide" path="/tapword/skills/e2e-testing/">
        <files>
        - SKILL.md
        - examples/login.spec.ts
        - fixtures/auth.json
        </files>
        <content>
        {SKILL.md body}
        </content>
        </skill>
    │
    ▼
LLM sees file listing, wants to read the example
    │
    ▼
LLM tool_use: read_file({ path: "/tapword/skills/e2e-testing/examples/login.spec.ts" })
    │
    ▼
readFileTool.execute():
    - validates path starts with /tapword/
    - tapWordFS.readFile(path) → returns file content
    │
    ▼
LLM now has both the skill guide AND the example code in context
    │
    ▼
LLM generates a well-informed E2E test
```

---

## 8. Deletion Flow

```
User clicks delete on "e2e-testing" skill card
    │
    ▼
App.handleDeleteSkill("e2e-testing")
    │
    ▼
SkillStorageService.deleteSkill("e2e-testing"):
    1. tapWordFS.deleteDir("/tapword/skills/e2e-testing")
       → OPFS removeEntry("e2e-testing", { recursive: true })
       → Deletes entire folder tree
    2. Read .index.json, filter out "e2e-testing", write back
    │
    ▼
UI state updates → skill card removed
```

---

## 9. Index Rebuild Flow

The `rebuildIndex()` function changes from scanning flat `.md` files to scanning subdirectories:

```
rebuildIndex():
    1. listDir("/tapword/skills/") → entries
    2. for each entry where kind === "directory" and name !== ".index.json":
        a. Try to readFile("/tapword/skills/{name}/SKILL.md")
        b. If SKILL.md missing → skip (log warning)
        c. parseSkillFile(content, "SKILL.md") → { name, description }
        d. listFilesRecursive("/tapword/skills/{name}/", "") → files[]
        e. Build SkillMeta { id: name, folderName: name, folderPath, files, ... }
    3. Write updated .index.json
```

---

## 10. Migration Strategy

Existing users may have skills stored as flat `/tapword/skills/{id}.md` files. A one-time migration is needed.

### Detection

On `loadSkillMetas()`, if the index is empty or missing:
1. Run `listDir("/tapword/skills/")`.
2. If any entries have `kind === "file"` and end with `.md`, trigger legacy migration.

### Migration Steps

For each legacy `{id}.md` file:
1. Read the file content.
2. Create directory `/tapword/skills/{id}/`.
3. Write content to `/tapword/skills/{id}/SKILL.md`.
4. Delete the old flat file `/tapword/skills/{id}.md`.
5. Build `SkillMeta` with `files: ["SKILL.md"]`.

After migration, rebuild the index.

### Safety

- Migration is idempotent: if `{id}/SKILL.md` already exists, skip.
- Log each migration step for debugging.
- If migration fails for a single skill, continue with the rest (don't block).

---

## 11. File Change Summary

| # | File | Change Type | Summary |
|---|------|-------------|---------|
| 1 | `types.ts` | **Modify** | Remove `sourceFileName`, add `folderName`, `folderPath`, `files` |
| 2 | `services/TapWordFS.ts` | **Modify** | Add `deleteDir(path)` method |
| 3 | `services/SkillStorageService.ts` | **Major rewrite** | Folder-aware import, delete, rebuild; add `getSkillFiles`, `readSkillFile`; remove `fileNameToId`; add migration logic |
| 4 | `agent/tools/skillTools.ts` | **Modify** | Enhanced `load_skill` response with `<files>` listing and `path` attribute |
| 5 | `agent/tools/readFileTool.ts` | **New** | `read_file` tool for LLM to read arbitrary VFS files |
| 6 | `agent/tools/index.ts` | **Modify** | Register `readFileTool` |
| 7 | `agent/prompts.ts` | **Modify** | Include folder path in skill listing; mention `read_file` in instructions |
| 8 | `components/SkillsPanel.tsx` | **Modify** | Switch to `webkitdirectory` folder input; update handler and props |
| 9 | `App.tsx` | **Modify** | Update `handleImportSkill` signature to accept folder + files array |
| 10 | `types.ts` or `global.d.ts` | **Modify** | Add `webkitdirectory` TypeScript declaration for JSX |

### Dependency Graph

```
types.ts (Skill, SkillMeta — updated fields)
    ↓
TapWordFS.ts (add deleteDir)
    ↓
SkillStorageService.ts (folder-aware CRUD, migration)
    ↓                        ↓
skillTools.ts            SkillsPanel.tsx
(enhanced response)      (folder import UI)
    ↓                        ↓
readFileTool.ts          App.tsx
(new tool)               (updated handler)
    ↓
tools/index.ts (register readFileTool)
    ↓
prompts.ts (folder path in listing)
```

**Implementation order**:
1. `types.ts` — field changes
2. `TapWordFS.ts` — add `deleteDir`
3. `SkillStorageService.ts` — folder-aware rewrite + migration
4. `agent/prompts.ts` — updated prompt format
5. `agent/tools/skillTools.ts` — enhanced response
6. `agent/tools/readFileTool.ts` — new tool
7. `agent/tools/index.ts` — register new tool
8. `components/SkillsPanel.tsx` — folder import UI
9. `App.tsx` — updated handler signature
10. TypeScript declaration for `webkitdirectory`

---

## 12. Verification Plan

### Unit Tests

| Test | File | What to verify |
|------|------|----------------|
| Folder name sanitization | `SkillStorageService.test.ts` | `sanitizeFolderName("My Skill (v2)")` → `"my-skill-v2"` |
| SKILL.md validation | `SkillStorageService.test.ts` | Import without SKILL.md throws descriptive error |
| Import writes all files | `SkillStorageService.test.ts` | Given 3 files, all are written to correct paths in VFS |
| Delete removes folder | `SkillStorageService.test.ts` | After delete, `exists()` returns false for folder and contents |
| Index rebuild from folders | `SkillStorageService.test.ts` | Given 2 skill folders, index has 2 entries with correct file lists |
| Legacy migration | `SkillStorageService.test.ts` | Flat `.md` files are moved into folders; index is correct after |
| `getSkillFiles` | `SkillStorageService.test.ts` | Returns correct relative path list for a multi-file skill |
| `readSkillFile` | `SkillStorageService.test.ts` | Returns correct content for a sub-file |
| `load_skill` response | `skillTools.test.ts` | Response contains `<files>` section with correct listing |
| `read_file` tool | `readFileTool.test.ts` | Reads file at valid path; returns error for invalid path |
| `read_file` path validation | `readFileTool.test.ts` | Rejects paths not starting with `/tapword/` |
| `deleteDir` | `TapWordFS.test.ts` | Recursively removes directory and all contents |
| System prompt format | `prompts.test.ts` | Skill listing includes folder path |
| `parseSkillFile` | `SkillStorageService.test.ts` | Unchanged — existing tests still pass |

### Manual Verification

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Import Skill" → select a folder with SKILL.md + sub-files | Skill card appears with correct name/description |
| 2 | Expand skill preview | SKILL.md body content displayed |
| 3 | Open chat, ask a question that triggers skill loading | LLM calls `load_skill`, response includes file listing |
| 4 | LLM calls `read_file` for a sub-file | Sub-file content returned correctly |
| 5 | Delete the skill | Skill removed from list; all files removed from VFS |
| 6 | Import a folder WITHOUT SKILL.md | Error message displayed; nothing imported |
| 7 | With legacy flat-file skills, open panel | Skills auto-migrated to folder structure |

---

## 13. Token Budget Impact

No significant change from the original spec (§8 of 260404-skill-import-spec):

| Item | Before | After |
|------|--------|-------|
| Per-skill Layer 1 line | ~20-30 tokens | ~30-40 tokens (folder path adds ~10 tokens) |
| `load_skill` response overhead | ~10 tokens (XML tags) | ~30-50 tokens (XML tags + file listing) |
| `read_file` tool response | N/A | File-size dependent (same as any tool result) |

The added overhead per skill in the system prompt is negligible (~10 extra tokens for the path). File listing in `load_skill` response is a small one-time cost when a skill is loaded.

---

## 14. Design Decisions

### Why folder name = skill ID?

Simplest possible mapping. No need for a separate ID generation function. The folder name is visible to the user, making it predictable and debuggable. Sanitization handles edge cases (spaces, special chars).

### Why require SKILL.md specifically?

Convention over configuration. Having a fixed entry-point name means:
- No need for a manifest file inside the skill folder.
- The `rebuildIndex` function can reliably find the entry document.
- Consistent with the `.agents/skills/*/SKILL.md` pattern already used in the project's own skill files.

### Why `webkitdirectory` over Drag-and-Drop?

- `webkitdirectory` is the simplest browser API for folder selection.
- Supported in Chrome (the primary target), Edge, and Firefox.
- Drag-and-drop requires more complex event handling and permission management.
- Can add drag-and-drop as a future enhancement without changing the underlying import logic.

### Why `read_file` as a general VFS tool (not skill-scoped)?

A general-purpose `read_file` tool scoped to `/tapword/` is more flexible:
- Can be used by future features (reading knowledge files, todo data, etc.).
- Simpler tool definition (one path parameter).
- Security is still maintained via the `/tapword/` path prefix check.
