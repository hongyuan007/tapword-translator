# Issue: Browser Crashes on Folder Import in Skills Panel

**Date**: 2026-07-14  
**Severity**: Critical (browser tab crash)  
**Module**: `src/13_sidepanel`  
**Environment**: Chrome Extension MV3 side panel

---

## Root Cause — Confirmed Chromium Bug

This is a **known, unfixed Chromium bug**: [chromium#365602120](https://issues.chromium.org/issues/365602120)

> **"input element with webkitdirectory attribute in chrome.sidePanel will cause chrome browser to crash"**

- **Filed**: Sep 10, 2024 | **Status**: Assigned (P2, S2) — still open
- **Reproducible on**: Chrome 118+ across all channels (Stable, Beta, Dev, Canary), on Linux/Windows/Mac
- **Component**: UI > Browser > ExtensionsManagement
- **Assignee**: so...@chromium.org

The `<input type="file" webkitdirectory>` element is fundamentally broken inside `chrome.sidePanel` pages. The crash happens at the browser level when the folder picker dialog is invoked — no amount of JS-level guards can prevent it.

**Implication**: The `webkitdirectory` approach must be abandoned. An alternative folder import mechanism is needed.

## Symptom

When the user clicks "Import Skill" in the Skills tab, selects a folder via the native folder picker (`webkitdirectory`), and confirms — the **browser tab immediately crashes**. No error messages are visible; the entire sidepanel/tab goes down.

## Reproduction Steps

1. Open the extension side panel
2. Navigate to the "Skills" tab
3. Click the "Import Skill" button
4. Select any folder containing a `SKILL.md` file
5. **Result**: Browser crashes

---

## Architecture Overview

The import flow is:

```
User clicks Import → <input type="file" webkitdirectory=""> 
    → onChange fires handleFolderImport()
    → Reads each file via file.text()
    → Calls onImportSkill(folderName, files[])
    → SkillStorageService.importSkill() writes each file to OPFS via TapWordFS.writeFile()
    → Updates .index.json
```

**Key technologies**:
- **OPFS** (Origin Private File System) via `navigator.storage.getDirectory()` — browser-native filesystem
- **webkitdirectory** — non-standard HTML attribute for folder picking
- **Chrome Extension MV3 Side Panel** — runs in a special `chrome-extension://` origin context

---

## Files Involved

### Primary (import flow)

| File | Role | Lines |
|------|------|-------|
| `src/13_sidepanel/components/SkillsPanel.tsx` | UI: folder picker, file reading, calls onImportSkill | 237 lines |
| `src/13_sidepanel/App.tsx` | Orchestrator: `handleImportSkill` calls SkillStorageService | 126 lines |
| `src/13_sidepanel/services/SkillStorageService.ts` | Business logic: validates, writes files to OPFS, updates index | ~250 lines |
| `src/13_sidepanel/services/TapWordFS.ts` | OPFS wrapper: `writeFile`, `deleteDir`, `readFile`, etc. | ~200 lines |

### Secondary (used by agent after import)

| File | Role |
|------|------|
| `src/13_sidepanel/agent/tools/skillTools.ts` | `load_skill` tool — reads SKILL.md body + file listing |
| `src/13_sidepanel/agent/tools/readFileTool.ts` | `read_file` tool — reads any VFS file |
| `src/13_sidepanel/agent/tools/index.ts` | Tool registry |
| `src/13_sidepanel/agent/prompts.ts` | System prompt with skill metadata |
| `src/13_sidepanel/types.ts` | `Skill`, `SkillMeta` interfaces |

---

## Current Code: SkillsPanel.tsx — handleFolderImport

```tsx
async function handleFolderImport(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files
    if (!fileList || fileList.length === 0) return

    try {
        setImporting(true)

        // Extract folder name from the first file's webkitRelativePath
        const firstPath = fileList[0]!.webkitRelativePath
        const folderName = firstPath.split("/")[0]!

        // Filter eligible files
        let eligible = Array.from(fileList).filter(shouldImportFile)
        if (eligible.length === 0) {
            logger.warn("No importable text files found in the selected folder")
            return
        }

        if (eligible.length > MAX_FILE_COUNT) {
            logger.warn(`Folder contains ${eligible.length} files, truncating to ${MAX_FILE_COUNT}`)
            eligible = eligible.slice(0, MAX_FILE_COUNT)
        }

        // Read filtered files and reconstruct relative paths
        const files: Array<{ relativePath: string; content: string }> = []
        for (const file of eligible) {
            const relativePath = file.webkitRelativePath.split("/").slice(1).join("/")
            const content = await file.text()
            files.push({ relativePath, content })
        }

        onImportSkill(folderName, files)
    } catch (error) {
        logger.error("Failed to import skill folder", error)
    } finally {
        setImporting(false)
        event.target.value = ""
    }
}
```

## Current Code: TapWordFS.writeFile

```typescript
async writeFile(path: string, content: string): Promise<void> {
    const { segments, name } = this.parsePath(path)
    const dir = await this.resolveDir(segments, true)
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(content)
    await writable.close()
    logger.info(`Wrote ${content.length} chars to ${path}`)
}
```

## Current Code: SkillStorageService.importSkill

```typescript
export async function importSkill(
    folderName: string,
    files: Array<{ relativePath: string; content: string }>
): Promise<SkillMeta> {
    // Validate inputs...
    const id = sanitizeFolderName(folderName)
    const entryFile = files.find((f) => f.relativePath === ENTRY_DOCUMENT)
    const { name, description, body } = parseSkillFile(entryFile.content, ENTRY_DOCUMENT)
    const folderPath = `${SKILLS_DIR}/${id}`

    // Write all files to OPFS
    for (const file of files) {
        await tapWordFS.writeFile(`${folderPath}/${file.relativePath}`, file.content)
    }

    // Build metadata, update index...
}
```

---

## File Listing for Reference

All files that were modified/created as part of the folder-based skill redesign:

```
src/13_sidepanel/types.ts                         — Skill, SkillMeta interfaces
src/13_sidepanel/services/TapWordFS.ts            — OPFS wrapper (added deleteDir)
src/13_sidepanel/services/SkillStorageService.ts  — Skill CRUD (major rewrite)
src/13_sidepanel/agent/tools/skillTools.ts        — load_skill tool (enhanced response)
src/13_sidepanel/agent/tools/readFileTool.ts      — NEW: read_file tool
src/13_sidepanel/agent/tools/index.ts             — Tool registry (added readFileTool)
src/13_sidepanel/agent/prompts.ts                 — System prompt (added workspace info)
src/13_sidepanel/components/SkillsPanel.tsx       — Skills UI (webkitdirectory folder picker)
src/13_sidepanel/App.tsx                          — Root component (updated import handler)
src/react-augment.d.ts                            — TypeScript declaration for webkitdirectory
```
