# Skill Document Import & Two-Layer Injection — Technical Specification

**Date**: 2026-04-04  
**Status**: Draft  
**Module**: `src/13_sidepanel`  
**Prerequisites**: Agent Side Panel (260403-agent-sidepanel-spec)

---

## 1. Motivation & Pattern Overview

### Problem

The agent's system prompt is a fixed string. As we add more domain-specific instructions (translation style guides, coding conventions, summarization templates, etc.), the system prompt balloons in size. Every token in the system prompt is sent on **every** LLM request, which:

- Wastes tokens and increases latency/cost on every turn
- Crowds out context window space needed for conversation history and tool results
- Makes the prompt harder to maintain and version

### Solution: Two-Layer Skill Injection

Borrowed from the reference pattern in `s05_skill_loading.py`, we split skill knowledge into two layers:

```
System prompt (sent every turn):
┌───────────────────────────────────────────┐
│ You are TapWord Agent...                  │
│                                           │
│ Skills available:                         │
│   - translation-style: Style guide for    │  ← Layer 1: ~20 tokens/skill
│     academic paper translation            │
│   - code-review: Best practices for       │
│     reviewing TypeScript code             │
└───────────────────────────────────────────┘

When model calls load_skill("translation-style"):
┌───────────────────────────────────────────┐
│ tool_result:                              │
│ <skill name="translation-style">          │
│   Full 2000-word style guide...           │  ← Layer 2: full body on demand
│   Rule 1: ...                             │
│   Rule 2: ...                             │
│ </skill>                                  │
└───────────────────────────────────────────┘
```

**Key insight**: "Don't put everything in the system prompt. Load on demand."

- **Layer 1** (cheap): Skill name + short description injected into system prompt. Cost: ~20-30 tokens per skill. Even with 50 skills, this adds only ~1500 tokens.
- **Layer 2** (on demand): Full skill body returned as `tool_result` when the LLM calls `load_skill("name")`. The LLM decides when it needs specialist knowledge and loads it explicitly.

### Why This Works Well for a Browser Extension

| Concern | Desktop Agent (reference) | Browser Extension (ours) |
|---------|--------------------------|--------------------------|
| Skill source | Filesystem (`.skills/*.md`) | User imports via file picker |
| Storage | Filesystem | `chrome.storage.local` |
| Skill discovery | Glob `*.md` at startup | Read from storage on panel open |
| System prompt injection | Build at process start | Build dynamically in `buildSystemPrompt()` |
| Load mechanism | `load_skill` tool handler reads file | `load_skill` tool handler reads from storage |

The pattern maps cleanly — the only adaptation is replacing filesystem I/O with `chrome.storage.local`.

---

## 2. Data Model

### 2.1 Skill Interface

```typescript
/** A single imported skill document. */
interface Skill {
    /** Unique identifier derived from filename (e.g., "translation-style"). */
    id: string
    /** Human-readable name from YAML frontmatter or filename. */
    name: string
    /** Short description for Layer 1 injection (~10-20 words). */
    description: string
    /** Full markdown body (Layer 2 content, excluding frontmatter). */
    body: string
    /** Original filename for display (e.g., "translation-style.md"). */
    sourceFileName: string
    /** Import timestamp (epoch ms). */
    importedAt: number
}

/** Metadata-only projection used for Layer 1 and UI listing. */
type SkillMeta = Pick<Skill, "id" | "name" | "description" | "sourceFileName" | "importedAt">
```

### 2.2 Storage Layout

All skill data is stored under a single `chrome.storage.local` key:

```typescript
const SKILLS_STORAGE_KEY = "agentSkills"

// Stored value shape:
type StoredSkills = Record<string, Skill>  // keyed by skill.id
```

**Why `chrome.storage.local`** (not `session` or `sync`):
- `session`: Cleared when browser closes. Skills are imported documents that users expect to persist.
- `sync`: Limited to 100KB total. A single skill body could exceed this.
- `local`: Up to 10MB (expandable with `unlimitedStorage` permission). Skills persist across sessions.

### 2.3 Markdown File Format

Imported `.md` files use optional YAML frontmatter:

```markdown
---
name: Translation Style Guide
description: Academic paper translation conventions for EN→CN
---

# Translation Style Guide

## Rule 1: Preserve Technical Terms
Always keep technical terms in their original language...

## Rule 2: Sentence Structure
...
```

**Parsing rules**:
1. If YAML frontmatter exists (`---\n...\n---\n`), extract `name` and `description` fields.
2. If `name` is missing, derive from filename: `"translation-style.md"` → `"translation-style"`.
3. If `description` is missing, use the first non-empty line of the body (truncated to 100 chars).
4. The `body` is everything after the closing `---` delimiter (or the entire file if no frontmatter).

---

## 3. Layer 1: System Prompt Injection

### 3.1 Current State

The system prompt is a static string constant in `agent/prompts.ts`:

```typescript
export const SYSTEM_PROMPT = `# Role
You are TapWord Agent, a helpful AI assistant.
...`
```

### 3.2 Target State

Convert `SYSTEM_PROMPT` to a function `buildSystemPrompt(skills)` that appends skill metadata:

```typescript
const BASE_SYSTEM_PROMPT = `# Role
You are TapWord Agent, a helpful AI assistant.

# Environment
You are embedded in the TapWord browser extension. The user is browsing a webpage and may ask questions or request tasks.

# Language
- Always reply in the same language the user is using.

# Task Management
- For complex requests, plan your work with a todo list and track progress as you go.

# Instructions
- Use the provided tools as needed to complete user requests.
- Be concise and helpful.`

/**
 * Build the full system prompt, appending Layer 1 skill metadata if any skills are available.
 * @param skills - Array of skill metadata to inject. Empty array = no skills section.
 */
export function buildSystemPrompt(skills: SkillMeta[]): string {
    if (skills.length === 0) {
        return BASE_SYSTEM_PROMPT
    }

    const skillLines = skills
        .map((s) => `  - ${s.id}: ${s.description}`)
        .join("\n")

    return `${BASE_SYSTEM_PROMPT}

# Skills
You have access to specialized knowledge documents. Use the load_skill tool to load a skill's full content before tackling unfamiliar topics.

Available skills:
${skillLines}`
}
```

### 3.3 Token Budget Analysis

| Component | Tokens (approx.) | Notes |
|-----------|-------------------|-------|
| Base system prompt | ~120 | Current static prompt |
| Skills section header | ~30 | Fixed overhead when ≥1 skill |
| Per-skill metadata line | ~20-30 | `"  - skill-id: Short description text"` |
| 10 skills | ~320-420 total | Base + header + 10 lines |
| 50 skills | ~1,150-1,650 total | Reasonable upper bound |

With qwen3.5-plus's **131,072 token** context window, even 50 skills in Layer 1 consume only ~1.3% of the budget. This is negligible.

**Layer 2 budget**: A loaded skill body (1,000-5,000 tokens typical) arrives as a `tool_result`, competing with conversation history for the remaining context. Users should keep individual skill documents under ~8,000 tokens for comfort.

---

## 4. Layer 2: `load_skill` Tool

### 4.1 Tool Definition

```typescript
// File: agent/tools/skillTools.ts

import * as loggerModule from "@/0_common/utils/logger"
import type { ToolRegistration } from "./types"

const logger = loggerModule.createLogger("skillTools")

/** Storage key for all skills in chrome.storage.local. */
const SKILLS_STORAGE_KEY = "agentSkills"

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
                    description: "The skill identifier (e.g., 'translation-style'). Must match one of the available skill IDs.",
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

        const result = await chrome.storage.local.get(SKILLS_STORAGE_KEY)
        const skills = (result[SKILLS_STORAGE_KEY] ?? {}) as Record<string, Skill>

        const skill = skills[skillId]
        if (!skill) {
            const available = Object.keys(skills).join(", ")
            logger.warn(`Skill not found: ${skillId}. Available: ${available}`)
            return `Error: Unknown skill '${skillId}'. Available skills: ${available || "(none)"}`
        }

        logger.info(`Loaded skill '${skillId}': ${skill.body.length} chars`)
        return `<skill name="${skill.name}">\n${skill.body}\n</skill>`
    },
}
```

### 4.2 Tool Registration

Add `loadSkillTool` to the `TOOL_REGISTRY` in `agent/tools/index.ts`:

```typescript
import { loadSkillTool } from "./skillTools"

const TOOL_REGISTRY = new Map<string, ToolRegistration>([
    // ... existing tools ...
    [loadSkillTool.definition.name, loadSkillTool],
])
```

### 4.3 AgentLoop Integration

The `AgentLoop` currently uses the static `SYSTEM_PROMPT` constant. It must be updated to:

1. Load skill metadata from storage before the agent loop starts.
2. Call `buildSystemPrompt(skillMetas)` to generate the effective system prompt.
3. Pass the built prompt to `client.messages.stream()`.

```typescript
// In AgentLoop.ts

import { buildSystemPrompt } from "./prompts"
import { loadSkillMetas } from "./tools/skillTools"

// In runAgent(), before the while loop:
const skillMetas = await loadSkillMetas()
const systemPrompt = buildSystemPrompt(skillMetas)

// Then use systemPrompt instead of SYSTEM_PROMPT:
const stream = this.client.messages.stream({
    model: DEFAULT_MODEL,
    system: systemPrompt,  // was: SYSTEM_PROMPT
    messages: this.history,
    tools: TOOL_DEFINITIONS,
    max_tokens: MAX_TOKENS,
})
```

The `loadSkillMetas()` helper is a lightweight read from `chrome.storage.local` that returns only the metadata fields (no `body`), keeping memory usage low:

```typescript
/** Load skill metadata only (for Layer 1 system prompt injection). */
export async function loadSkillMetas(): Promise<SkillMeta[]> {
    const result = await chrome.storage.local.get(SKILLS_STORAGE_KEY)
    const skills = (result[SKILLS_STORAGE_KEY] ?? {}) as Record<string, Skill>
    return Object.values(skills).map(({ id, name, description, sourceFileName, importedAt }) => ({
        id, name, description, sourceFileName, importedAt,
    }))
}
```

---

## 5. Skill Storage Service

### 5.1 SkillStorageService

A dedicated service for CRUD operations on skills, following the same pattern as the existing `StorageService.ts`:

```typescript
// File: services/SkillStorageService.ts

import * as loggerModule from "@/0_common/utils/logger"
import type { Skill, SkillMeta } from "../types"

const logger = loggerModule.createLogger("SkillStorageService")

const SKILLS_STORAGE_KEY = "agentSkills"

/** Parse YAML frontmatter from a markdown string. */
export function parseSkillFile(
    content: string,
    fileName: string
): { name: string; description: string; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)/)
    let meta: Record<string, string> = {}
    let body: string

    if (match) {
        // Parse simple key: value YAML lines
        for (const line of match[1].trim().split("\n")) {
            const colonIdx = line.indexOf(":")
            if (colonIdx > 0) {
                const key = line.slice(0, colonIdx).trim()
                const val = line.slice(colonIdx + 1).trim()
                meta[key] = val
            }
        }
        body = match[2].trim()
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

/** Derive a stable ID from a filename. */
function fileNameToId(fileName: string): string {
    return fileName
        .replace(/\.(md|txt)$/, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
}

/** Load all skills from storage. */
export async function loadAllSkills(): Promise<Record<string, Skill>> {
    try {
        const result = await chrome.storage.local.get(SKILLS_STORAGE_KEY)
        return (result[SKILLS_STORAGE_KEY] ?? {}) as Record<string, Skill>
    } catch {
        return {}
    }
}

/** Load metadata-only list for Layer 1 injection and UI display. */
export async function loadSkillMetas(): Promise<SkillMeta[]> {
    const skills = await loadAllSkills()
    return Object.values(skills).map(
        ({ id, name, description, sourceFileName, importedAt }) => ({
            id, name, description, sourceFileName, importedAt,
        })
    )
}

/** Import a skill from raw file content. Overwrites if same ID exists. */
export async function importSkill(fileName: string, fileContent: string): Promise<Skill> {
    const id = fileNameToId(fileName)
    const { name, description, body } = parseSkillFile(fileContent, fileName)
    const skill: Skill = {
        id,
        name,
        description,
        body,
        sourceFileName: fileName,
        importedAt: Date.now(),
    }

    const skills = await loadAllSkills()
    skills[id] = skill
    await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: skills })
    logger.info(`Imported skill '${id}' (${body.length} chars)`)
    return skill
}

/** Delete a skill by ID. */
export async function deleteSkill(skillId: string): Promise<void> {
    const skills = await loadAllSkills()
    delete skills[skillId]
    await chrome.storage.local.set({ [SKILLS_STORAGE_KEY]: skills })
    logger.info(`Deleted skill '${skillId}'`)
}

/** Get a single skill's full content by ID. */
export async function getSkillBody(skillId: string): Promise<string | null> {
    const skills = await loadAllSkills()
    return skills[skillId]?.body ?? null
}
```

---

## 6. UI Changes: SettingsDrawer

### 6.1 Current State

`SettingsDrawer.tsx` currently contains only an API key input field with save/close buttons.

### 6.2 Target State

Add a "Skills" section below the API key section with:

1. **Import button**: Triggers a hidden `<input type="file">` accepting `.md` and `.txt` files.
2. **Skill list**: Shows imported skills with name, description preview, and a delete button.
3. **Empty state**: Shows a helpful message when no skills are imported.

### 6.3 UI Wireframe

```
┌─────────────────────────────────────┐
│ API Key Settings                  ✕ │
│ ┌─────────────────────────┐ ┌────┐ │
│ │ sk-*****1234            │ │Save│ │
│ └─────────────────────────┘ └────┘ │
│ Current: sk-ab...xyz4               │
│                                     │
│ ─────────────────────────────────── │
│                                     │
│ Skills                   [+ Import] │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 📄 translation-style        ✕  │ │
│ │ Academic paper translation      │ │
│ │ conventions for EN→CN           │ │
│ ├─────────────────────────────────┤ │
│ │ 📄 code-review              ✕  │ │
│ │ Best practices for reviewing    │ │
│ │ TypeScript code                 │ │
│ └─────────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

### 6.4 Component Design

The `SettingsDrawer` props interface expands to accept skill data and callbacks:

```typescript
interface SettingsDrawerProps {
    // Existing props
    apiKeyInput: string
    onApiKeyInputChange: (value: string) => void
    onSave: () => void
    onClose: () => void
    currentKeyPreview: string | null
    // New props for skills
    skills: SkillMeta[]
    onImportSkill: (fileName: string, content: string) => void
    onDeleteSkill: (skillId: string) => void
}
```

The file input handling is straightforward:

```tsx
function handleFileImport(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
        const content = reader.result as string
        onImportSkill(file.name, content)
    }
    reader.readAsText(file)

    // Reset input so re-importing same file triggers onChange
    event.target.value = ""
}
```

### 6.5 State Management

Skill state is managed at the `App.tsx` level (or within `useAgentChat`) and passed down to `SettingsDrawer`:

```typescript
// In App.tsx or a dedicated useSkills hook:
const [skills, setSkills] = useState<SkillMeta[]>([])

useEffect(() => {
    SkillStorageService.loadSkillMetas().then(setSkills)
}, [])

const handleImportSkill = async (fileName: string, content: string) => {
    const skill = await SkillStorageService.importSkill(fileName, content)
    setSkills((prev) => [...prev.filter((s) => s.id !== skill.id), skill])
}

const handleDeleteSkill = async (skillId: string) => {
    await SkillStorageService.deleteSkill(skillId)
    setSkills((prev) => prev.filter((s) => s.id !== skillId))
}
```

---

## 7. End-to-End Flow

### 7.1 Skill Import Flow

```
User clicks [+ Import] in SettingsDrawer
    │
    ▼
<input type="file" accept=".md,.txt"> opens native file picker
    │
    ▼
User selects "translation-style.md"
    │
    ▼
FileReader reads content as text
    │
    ▼
parseSkillFile() extracts frontmatter (name, description) + body
    │
    ▼
SkillStorageService.importSkill() writes to chrome.storage.local
    │
    ▼
UI state updates → skill appears in SettingsDrawer list
```

### 7.2 Skill Usage Flow (Runtime)

```
User sends message: "Translate this paragraph"
    │
    ▼
AgentLoop.runAgent() starts
    │
    ▼
loadSkillMetas() reads metadata from chrome.storage.local
    │
    ▼
buildSystemPrompt(metas) generates system prompt with Layer 1:
    "Skills available:
       - translation-style: Academic paper translation conventions for EN→CN"
    │
    ▼
LLM sees available skills in system prompt, decides to load one
    │
    ▼
LLM returns tool_use: load_skill({ skill_id: "translation-style" })
    │
    ▼
loadSkillTool.execute() reads full body from chrome.storage.local
    │
    ▼
Returns tool_result: "<skill name='...'>\n...full body...\n</skill>"
    │
    ▼
LLM now has specialized knowledge in context, generates informed response
```

---

## 8. Token Budget Analysis

### Context Window: 131,072 tokens (qwen3.5-plus)

| Budget Item | Tokens | % of Total |
|-------------|--------|------------|
| System prompt (base) | ~120 | 0.09% |
| Layer 1 skills (10 imported) | ~300 | 0.23% |
| Layer 1 skills (50 imported) | ~1,500 | 1.14% |
| Loaded skill body (typical) | 1,000–5,000 | 0.8%–3.8% |
| Loaded skill body (large) | 8,000 | 6.1% |
| Conversation history (long session) | 20,000–60,000 | 15%–46% |
| Max tokens per response | 10,000 | 7.6% |
| **Remaining for tools + history** | **~60,000–100,000** | **46%–76%** |

**Conclusion**: The two-layer approach keeps the per-turn overhead minimal. Even aggressive skill loading leaves ample room for conversation.

### Recommended Limits

| Limit | Value | Rationale |
|-------|-------|-----------|
| Max skills imported | 100 | Storage and UI sanity |
| Max skill body size | 50,000 chars (~12K tokens) | Keep Layer 2 payload reasonable |
| Warning threshold | 20,000 chars (~5K tokens) | Show "large skill" warning in UI on import |

---

## 9. File Change List

| # | File | Change Type | Summary |
|---|------|-------------|---------|
| 1 | `src/13_sidepanel/types.ts` | **Modify** | Add `Skill` and `SkillMeta` type definitions |
| 2 | `src/13_sidepanel/services/SkillStorageService.ts` | **New** | CRUD operations for skills: `importSkill`, `deleteSkill`, `loadSkillMetas`, `loadAllSkills`, `parseSkillFile` |
| 3 | `src/13_sidepanel/agent/prompts.ts` | **Modify** | Convert static `SYSTEM_PROMPT` to `buildSystemPrompt(skills: SkillMeta[])` function. Export the base prompt separately for testing. |
| 4 | `src/13_sidepanel/agent/tools/skillTools.ts` | **New** | `loadSkillTool` ToolRegistration. Reads full skill body from `chrome.storage.local` and returns it wrapped in `<skill>` tags. |
| 5 | `src/13_sidepanel/agent/tools/index.ts` | **Modify** | Import and register `loadSkillTool` in `TOOL_REGISTRY` |
| 6 | `src/13_sidepanel/agent/AgentLoop.ts` | **Modify** | Replace static `SYSTEM_PROMPT` with dynamic `buildSystemPrompt()`. Load skill metadata at start of `runAgent()`. |
| 7 | `src/13_sidepanel/components/SettingsDrawer.tsx` | **Modify** | Add Skills management section: import button, skill list with delete, empty state |
| 8 | `src/13_sidepanel/App.tsx` | **Modify** | Add skill state management (`useState` + storage load). Pass skill props to `SettingsDrawer`. |

### Dependency Graph

```
types.ts (Skill, SkillMeta)
    ↓
SkillStorageService.ts (imports types)
    ↓                ↓
skillTools.ts    SettingsDrawer.tsx
(imports service)  (imports service via App)
    ↓
tools/index.ts (registers tool)
    ↓
AgentLoop.ts (uses buildSystemPrompt + registry)
    ↓
prompts.ts (buildSystemPrompt uses SkillMeta type)
```

**Implementation order**: types → service → prompts → skillTools → index → AgentLoop → SettingsDrawer → App

---

## 10. Design Decisions & Alternatives

### 10.1 Why `chrome.storage.local` over IndexedDB?

| Factor | chrome.storage.local | IndexedDB |
|--------|---------------------|-----------|
| API simplicity | key-value, 2 lines of code | Verbose cursor/transaction API |
| Size limit | 10MB (enough for ~100 skills) | Unlimited |
| Serialization | Automatic JSON | Manual structuredClone |
| Existing pattern | Used by `StorageService.ts` | Used by `KnowledgeStore.ts` |

**Decision**: Use `chrome.storage.local` for simplicity. Skill bodies are text-only — no binary data. If the 10MB limit becomes an issue in practice, migrate to IndexedDB later. This is unlikely given typical skill sizes (1-10KB each).

### 10.2 Why File Import over URL Fetch?

- Chrome extensions have strict CSP — fetching arbitrary URLs for skill content is fragile.
- File picker is a familiar, trusted UX pattern.
- Users maintain full control over what enters the extension.
- No CORS issues, no network dependency.

### 10.3 Why Not a Dedicated `SkillStore` Class?

The `KnowledgeStore` uses a class because it manages IndexedDB connections and embedding state. Skills are simple key-value reads/writes to `chrome.storage.local` — a set of exported functions (like the existing `StorageService.ts`) is simpler and sufficient.

---

## 11. Future Enhancements (Out of Scope)

- **Skill editing in-panel**: Edit skill body directly in the sidepanel UI (currently read-only after import).
- **Skill sharing**: Export/import skill packs as JSON bundles.
- **Built-in skills**: Ship default skills with the extension (e.g., translation best practices).
- **Skill versioning**: Track and diff skill content changes on re-import.
- **Auto-load heuristic**: Automatically load relevant skills based on user query embedding similarity to skill descriptions, bypassing the LLM's explicit tool call.
- **Skill tags/categories**: Organize skills with filterable tags in the UI.
