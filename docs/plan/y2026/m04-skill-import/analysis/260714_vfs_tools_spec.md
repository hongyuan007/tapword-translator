# VFS File Management Tools for Sidepanel Agent

**Date**: 2026-07-14  
**Status**: Spec  
**Module**: `src/13_sidepanel/agent/tools/`

---

## 1. Current State

### Existing File-Related Tools

| Tool | File | Description |
|------|------|-------------|
| `read_file` | `readFileTool.ts` | Reads a file from VFS at a given `/tapword/...` path. Returns content string or error message. |

### TapWordFS API (Available Methods)

The OPFS wrapper at `src/13_sidepanel/services/TapWordFS.ts` exposes:

| Method | Signature | Notes |
|--------|-----------|-------|
| `readFile` | `(path) → Promise<string>` | Throws if not found |
| `writeFile` | `(path, content) → Promise<void>` | Auto-creates parent dirs |
| `deleteFile` | `(path) → Promise<void>` | No-op if missing |
| `deleteDir` | `(path) → Promise<void>` | Recursive; no-op if missing |
| `listDir` | `(path) → Promise<DirEntry[]>` | Returns `{name, kind}[]`; `[]` for missing dirs |
| `exists` | `(path) → Promise<boolean>` | Checks file or directory |
| `stat` | `(path) → Promise<FileStat>` | File only; throws if not found |

### Existing Tool Pattern (`ToolRegistration`)

```typescript
// src/13_sidepanel/agent/tools/types.ts
export interface ToolRegistration {
    definition: Anthropic.Tool   // name, description, input_schema
    label: string                // UI label shown during execution
    execute: (input: Record<string, unknown>) => Promise<string>
}
```

Conventions observed in `readFileTool.ts`:
- Validate `path` is non-empty and starts with `/tapword/`.
- Return user-friendly error strings (not thrown exceptions) for expected failures.
- Use `createLogger()` for logging.
- Import `tapWordFS` singleton from `../../services/TapWordFS`.
- Define `VFS_PATH_PREFIX = "/tapword/"` as a constant.

---

## 2. Design Decision: Tool Selection

### Goal
Provide the LLM agent with essential CRUD operations for files and directories. Minimize tool count while covering the common use cases.

### Analysis of Candidate Tools

| Candidate | Verdict | Rationale |
|-----------|---------|-----------|
| `list_directory` | **Include** | Essential for exploring VFS structure. No alternative exists. |
| `write_file` | **Include** | Essential for creating and updating files. `writeFile` auto-creates parent dirs, so this implicitly handles directory creation too. |
| `delete_file` | **Include** | Essential for removing individual files. |
| `delete_directory` | **Include** | Needed for cleaning up skill folders or directory trees. `delete_file` cannot remove directories. |
| `create_directory` | **Omit** | `write_file` auto-creates parent directories. The LLM rarely needs to create an empty directory. Can be added later if needed. |
| `move_file` | **Omit** | OPFS has no native move/rename — would require read+write+delete emulation. The LLM can perform these steps manually. Adds complexity for a low-frequency operation. Defer to a future iteration. |

### Final Tool Set (4 new tools)

Combined with existing `read_file`, this gives **5 total file management tools**:

1. `read_file` *(existing)* — Read file content
2. `list_directory` — List directory entries  
3. `write_file` — Create or overwrite a file
4. `delete_file` — Delete a single file
5. `delete_directory` — Recursively delete a directory

---

## 3. Tool Specifications

### 3.1 `list_directory`

**Purpose**: List files and subdirectories at a given VFS path.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Absolute directory path (e.g., '/tapword/skills/')"
    }
  },
  "required": ["path"]
}
```

**Label**: `"Listing directory..."`

**Return Format**:
- On success: Formatted listing, one entry per line. Directories suffixed with `/`. Example:
  ```
  Directory: /tapword/skills/
  
  e2e-testing/
  code-review/
  README.md
  notes.txt
  
  4 entries
  ```
- Empty directory: `"Directory '/tapword/skills/' is empty."`
- Invalid path: `"Error: Invalid path '...'. Path must start with '/tapword/'."`

**Edge Cases**:
- Path does not exist → Return empty listing (TapWordFS.listDir returns `[]` for missing dirs).
- Path points to a file, not a directory → Return empty listing (same behavior from FS layer).
- Trailing slash optional — tool should normalize.

**Underlying API**: `tapWordFS.listDir(path)`

---

### 3.2 `write_file`

**Purpose**: Create a new file or overwrite an existing file. Parent directories are created automatically.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Absolute file path (e.g., '/tapword/skills/my-skill/SKILL.md')"
    },
    "content": {
      "type": "string",
      "description": "The text content to write to the file"
    }
  },
  "required": ["path", "content"]
}
```

**Label**: `"Writing file..."`

**Return Format**:
- On success: `"Successfully wrote 1234 chars to /tapword/skills/my-skill/SKILL.md"`
- Invalid path: `"Error: Invalid path '...'. Path must start with '/tapword/'."`
- Write failure: `"Error: Failed to write to /tapword/...: <error message>"`

**Edge Cases**:
- File already exists → Overwrite silently (this is `writeFile` behavior).
- Parent directories don't exist → Auto-created by TapWordFS.
- Empty content → Allowed; creates an empty file.
- Path ends with `/` → Return error (path should point to a file, not directory).

**Underlying API**: `tapWordFS.writeFile(path, content)`

---

### 3.3 `delete_file`

**Purpose**: Delete a single file from the VFS.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Absolute file path to delete (e.g., '/tapword/skills/old-skill/notes.txt')"
    }
  },
  "required": ["path"]
}
```

**Label**: `"Deleting file..."`

**Return Format**:
- On success: `"Deleted file: /tapword/skills/old-skill/notes.txt"`
- File not found: `"Deleted file: /tapword/skills/old-skill/notes.txt"` (no-op — TapWordFS.deleteFile is idempotent, so we return success regardless).
- Invalid path: `"Error: Invalid path '...'. Path must start with '/tapword/'."`

**Edge Cases**:
- Path does not exist → Success (idempotent delete, consistent with TapWordFS behavior).
- Path points to a directory → TapWordFS.deleteFile will fail silently (no-op). This is intentional — use `delete_directory` instead. Consider adding a hint: `"No file found at path. If this is a directory, use delete_directory instead."`

**Implementation Note**: To provide the directory hint, check `tapWordFS.exists(path)` after deleteFile. If the path still exists, it's likely a directory.

**Underlying API**: `tapWordFS.deleteFile(path)`

---

### 3.4 `delete_directory`

**Purpose**: Recursively delete a directory and all its contents.

**Input Schema**:
```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Absolute directory path to delete (e.g., '/tapword/skills/old-skill/')"
    }
  },
  "required": ["path"]
}
```

**Label**: `"Deleting directory..."`

**Return Format**:
- On success: `"Deleted directory: /tapword/skills/old-skill/"`
- Directory not found: `"Deleted directory: /tapword/skills/old-skill/"` (idempotent).
- Invalid path: `"Error: Invalid path '...'. Path must start with '/tapword/'."`

**Edge Cases**:
- Path does not exist → Success (idempotent).
- Path points to a file → TapWordFS.deleteDir may fail or no-op. This is acceptable — use `delete_file` for files.
- Attempting to delete `/tapword/` root → Should be **blocked**. Add a guard: `"Error: Cannot delete the root directory."`

**Safety Guard**: Refuse to delete `/tapword/` itself (prevent wiping the entire VFS).

**Underlying API**: `tapWordFS.deleteDir(path)`

---

## 4. System Prompt Update

The system prompt in `src/13_sidepanel/agent/prompts.ts` currently mentions:

```
Your virtual filesystem is rooted at `/tapword/`. Use the `read_file` tool to read files from it.
```

Update to:

```
Your virtual filesystem is rooted at `/tapword/`. You can manage files and directories with these tools:
- `read_file` — read a file
- `list_directory` — list directory contents
- `write_file` — create or overwrite a file
- `delete_file` — delete a file
- `delete_directory` — recursively delete a directory
```

---

## 5. Files to Create/Modify

### New Files

| File | Description |
|------|-------------|
| `src/13_sidepanel/agent/tools/fileTools.ts` | Contains all 4 new tool definitions (`listDirectoryTool`, `writeFileTool`, `deleteFileTool`, `deleteDirectoryTool`). Grouped in a single file since they share the same constants and import pattern. |

### Modified Files

| File | Change |
|------|--------|
| `src/13_sidepanel/agent/tools/index.ts` | Import from `fileTools.ts`; register 4 new tools in `TOOL_REGISTRY`. |
| `src/13_sidepanel/agent/prompts.ts` | Update workspace section to list all file management tools. |

### No Changes Needed

| File | Reason |
|------|--------|
| `src/13_sidepanel/services/TapWordFS.ts` | All required methods already exist. |
| `src/13_sidepanel/agent/tools/readFileTool.ts` | Remains unchanged. Already works correctly. |
| `src/13_sidepanel/agent/tools/types.ts` | `ToolRegistration` interface is sufficient. |

---

## 6. Implementation Notes

### Shared Constants

Extract `VFS_PATH_PREFIX` validation into a shared helper to avoid duplication across `readFileTool.ts` and `fileTools.ts`:

```typescript
// In fileTools.ts (or a shared util if needed later)
const VFS_PATH_PREFIX = "/tapword/"
const VFS_ROOT_PATH = "/tapword"

function validatePath(path: string): string | null {
    if (!path) return "path is required"
    if (!path.startsWith(VFS_PATH_PREFIX)) {
        return `Invalid path '${path}'. Path must start with '${VFS_PATH_PREFIX}'.`
    }
    return null  // valid
}
```

For now, keep this private to `fileTools.ts`. If `readFileTool.ts` is refactored later, the helper can be extracted to a shared module.

### Grouping Strategy

All 4 new tools in a single `fileTools.ts` file (similar to how `todoTools.ts` groups 3 related tools). This keeps the tools directory clean and makes co-located changes easy.

### Error Handling Pattern

Follow the `readFileTool.ts` convention:
- **Expected errors** (missing file, invalid path): Return a descriptive error string.
- **Unexpected errors** (OPFS failure): Catch, log via `logger.error()`, and return a generic error string.
- **Never throw** from `execute()` — always return a string.

---

## 7. Verification Plan

### Type Check
```bash
npm run type-check
```
Must pass with 0 new errors.

### Manual Verification

Test each tool via the sidepanel agent chat:

| # | Test | Expected |
|---|------|----------|
| 1 | "List the contents of /tapword/" | Agent calls `list_directory`, shows skill folders |
| 2 | "Create a file at /tapword/test/hello.txt with content 'Hello World'" | Agent calls `write_file`, confirms success |
| 3 | "Read /tapword/test/hello.txt" | Agent calls `read_file`, shows "Hello World" |
| 4 | "List /tapword/test/" | Agent calls `list_directory`, shows `hello.txt` |
| 5 | "Delete /tapword/test/hello.txt" | Agent calls `delete_file`, confirms deletion |
| 6 | "Delete the /tapword/test/ directory" | Agent calls `delete_directory`, confirms |
| 7 | "List /tapword/test/" | Returns empty (dir was deleted) |
| 8 | "Write to /tapword/a/b/c/deep.txt" | Auto-creates nested parents, write succeeds |
| 9 | "Delete /tapword/" (root) | Agent receives error: cannot delete root |
| 10 | "List /tapword/nonexistent/" | Returns empty listing |

### Unit Tests (Optional, Future)

Test the `execute` functions with mocked `tapWordFS`:
- Path validation rejects bad paths
- Successful CRUD operations return correct messages
- Error handling returns error strings (not exceptions)
