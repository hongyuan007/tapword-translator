# m04-skill-import: Two-Layer Skill Injection for Agent Sidepanel

---

## Phase 1: Single-File Skill Import — Complete

**Status**: Complete

### Spec
- [260404-skill-import-spec.md](../m04/agent-side-panel/260404-skill-import-spec.md)
- [260404-opfs-virtualfs-spec.md](../m04/agent-side-panel/260404-opfs-virtualfs-spec.md)

### Implementation Progress

| # | File | Status | Notes |
|---|------|--------|-------|
| 1 | `src/13_sidepanel/types.ts` | Done | Added Skill, SkillMeta types |
| 2 | `src/13_sidepanel/services/SkillStorageService.ts` | Done | Refactored: OPFS-backed via TapWordFS, index file management, removed chrome.storage.local |
| 3 | `src/13_sidepanel/agent/prompts.ts` | Done | Converted static SYSTEM_PROMPT to buildSystemPrompt(skills) function |
| 4 | `src/13_sidepanel/agent/tools/skillTools.ts` | Done | Refactored: uses SkillStorageService instead of direct chrome.storage.local |
| 5 | `src/13_sidepanel/agent/tools/index.ts` | Done | Registered loadSkillTool in TOOL_REGISTRY |
| 6 | `src/13_sidepanel/agent/AgentLoop.ts` | Done | Dynamic system prompt via buildSystemPrompt() + loadSkillMetas() |
| 7 | `src/13_sidepanel/components/SettingsDrawer.tsx` | Done | Skills UI section: import button, skill list with delete, empty state |
| 8 | `src/13_sidepanel/App.tsx` | Done | Added SkillMigration.migrateIfNeeded() call before loading skills |
| 9 | `src/13_sidepanel/store/TapWordFS.ts` | Done | New: OPFS wrapper class with singleton tapWordFS (readFile, writeFile, deleteFile, listDir, exists, stat) |
| 10 | `src/13_sidepanel/services/SkillMigration.ts` | Done | New: one-time transparent migration from chrome.storage.local to OPFS |

### Type Check
- `npm run type-check` passes with 0 errors

---

## Phase 2: Folder-Based Skill Import — In Progress

**Status**: Implementation Complete (pending tests & manual verification)  
**Started**: 2026-07-14

### Spec
- [260714_folder_skill_redesign.md](analysis/260714_folder_skill_redesign.md)

### Task Checklist

| # | Task | File(s) | Status | Notes |
|---|------|---------|--------|-------|
| 1 | Update `Skill` and `SkillMeta` interfaces | `types.ts` | ✅ Done | Removed `sourceFileName`, added `folderName`. `SkillMeta` is now its own interface with `folderPath` and `files`. |
| 2 | Add `deleteDir` to TapWordFS | `services/TapWordFS.ts` | ✅ Done | Added to both `ITapWordFS` interface and `TapWordFS` class with `{ recursive: true }`. |
| 3 | Rewrite SkillStorageService for folders | `services/SkillStorageService.ts` | ✅ Done | Folder-aware import/delete/rebuild; added `getSkillFiles`, `readSkillFile`, `sanitizeFolderName`, `listFilesRecursive`; legacy migration logic; removed `fileNameToId` and `loadAllSkills`. |
| 4 | Update system prompt format | `agent/prompts.ts` | ✅ Done | Skill listing includes folder path; instructions mention `read_file` tool. |
| 5 | Enhance `load_skill` response | `agent/tools/skillTools.ts` | ✅ Done | Response now includes `<files>` listing and `path` attribute in XML. |
| 6 | Create `read_file` tool | `agent/tools/readFileTool.ts` | ✅ Done | New tool for LLM to read any VFS file under `/tapword/`. |
| 7 | Register `readFileTool` | `agent/tools/index.ts` | ✅ Done | Added to TOOL_REGISTRY. |
| 8 | Switch to folder import UI | `components/SkillsPanel.tsx` | ✅ Done | `webkitdirectory` folder input, `handleFolderImport`, updated props. |
| 9 | Update import handler signature | `App.tsx` | ✅ Done | Now accepts `(folderName, files[])` and returns `SkillMeta`. |
| 10 | Add `webkitdirectory` TS declaration | `src/react-augment.d.ts` | ✅ Done | Separate module augmentation file for React. |
| 11 | Legacy migration logic | `services/SkillStorageService.ts` | ✅ Done | Auto-migrates flat `.md` files to folder structure in `loadSkillMetas`. |
| 12 | Unit tests | `tests/` | ⬜ Not Started | Cover import, delete, rebuild, migration, tools |
| 13 | Manual verification | — | ⬜ Not Started | Full flow testing per verification plan |

### Log

| Date | Update |
|------|--------|
| 2026-07-14 | Technical redesign spec created. All tasks pending. |
| 2026-07-14 | Implementation complete (tasks 1-11). Type-check passes with 0 new errors. Tests and manual verification pending. |

---

## Phase 3: VFS File Management Tools — Spec

**Status**: Spec Complete  
**Started**: 2026-07-14

### Spec
- [260714_vfs_tools_spec.md](analysis/260714_vfs_tools_spec.md)

### Summary
Add 4 new file management tools to the sidepanel LLM agent (`list_directory`, `write_file`, `delete_file`, `delete_directory`). Combined with existing `read_file`, this gives the agent full CRUD capabilities on the OPFS virtual filesystem.

### Task Checklist

| # | Task | File(s) | Status | Notes |
|---|------|---------|--------|-------|
| 1 | Implement 4 VFS tools | `agent/tools/fileTools.ts` | ✅ Done | `listDirectoryTool`, `writeFileTool`, `deleteFileTool`, `deleteDirectoryTool` |
| 2 | Register in TOOL_REGISTRY | `agent/tools/index.ts` | ✅ Done | Import + register 4 entries |
| 3 | Update system prompt | `agent/prompts.ts` | ✅ Done | List all 5 file tools in workspace section |
| 4 | Type check | — | ✅ Done | `npm run type-check` passes |
| 5 | Manual verification | — | ⬜ Not Started | 10-case test plan in spec |

### Log

| Date | Update |
|------|--------|
| 2026-07-14 | Spec created: 4 new tools, 1 new file + 2 modified files. |
| 2026-04-04 | Implementation complete (tasks 1-4). Type-check passes. Manual verification pending. |
---

## Phase 4: `fetch_url` and `search_files` Tools — Spec

**Status**: Spec Complete  
**Started**: 2026-07-14

### Spec
- [260714_fetch_search_tools_spec.md](analysis/260714_fetch_search_tools_spec.md)

### Summary
Add 2 new tools to the sidepanel LLM agent: `fetch_url` (fetch web pages and convert to markdown) and `search_files` (grep-like text search across VFS files). `fetch_url` delegates fetching to the background service worker for CORS bypass, then uses `@mozilla/readability` + `turndown` in sidebar for HTML→Markdown conversion. `search_files` recursively scans VFS files with plain text or regex matching.

### Task Checklist

| # | Task | File(s) | Status | Notes |
|---|------|---------|--------|-------|
| 1 | Add `<all_urls>` to `host_permissions` | `manifest.json` | ✅ Done | Required for CORS-free fetching |
| 2 | Add `FETCH_URL` message type | `0_common/types/` | ✅ Done | — |
| 3 | Add `FETCH_URL` handler in background | `2_background/messaging/MessageRouter.ts` | ✅ Done | fetch() + return body + metadata |
| 4 | Install `@mozilla/readability` + `turndown` | `package.json` | ✅ Done | + `@types/turndown` |
| 5 | Implement `fetch_url` tool | `agent/tools/fetchUrlTool.ts` | ✅ Done | HTML detect → readability → turndown → truncate |
| 6 | Implement `search_files` tool | `agent/tools/searchFilesTool.ts` | ✅ Done | Recursive VFS walk + line matching |
| 7 | Register both tools | `agent/tools/index.ts` | ✅ Done | — |
| 8 | Update system prompt | `agent/prompts.ts` | ✅ Done | Document both new tools |
| 9 | Type check | — | ✅ Done | — |
| 10 | Verification | — | ⬜ Not Started | 20+ test cases in spec |

### Log

| Date | Update |
|------|--------|
| 2026-07-14 | Technical spec created with research summary, tool designs, and verification plan. |
| 2026-04-04 | Implementation complete (tasks 1-9). Type-check pending. Manual verification pending. |