# Level-Based Few-Shot Examples for Auto-Candidates

*Created: 2026-03-12*
*Status: Draft*
*Author: AI Agent (codebase-derived)*

---

## 1. Current State Analysis

### 1.1 Few-Shot File Format (Both Projects)

Both projects use an identical JSON format: a flat array of `ChatMessage` objects with alternating `user` / `assistant` roles.

```json
[
  { "role": "user",      "content": "<user prompt text>" },
  { "role": "assistant", "content": "<assistant response JSON>" },
  { "role": "user",      "content": "<user prompt text>" },
  { "role": "assistant", "content": "<assistant response JSON>" }
]
```

Each `{user, assistant}` pair is one few-shot example. The pairs are injected **between** the system prompt and the final user prompt in the message array sent to the LLM.

### 1.2 Few-Shot Naming Convention

| Convention | Example |
|------------|---------|
| Directory layout | `resources/generate/<taskName>/<lang>/fewshot.json` (backend) |
| Directory layout | `resources/8_generate/<taskName>/<lang>/fewshot.json` (frontend) |
| Language dirs | `en/`, `zh/`, `ja/`, `ko/`, `de/`, `es/`, `fr/`, `it/`, `pt/`, `ru/` |
| Default file | `fewshot.json` (always this name within a language dir) |

Example paths:
- Backend: `resources/generate/word_translation/zh/fewshot.json`
- Frontend: `resources/8_generate/word_translation/en/fewshot.json`

### 1.3 How `promptLoader` Loads Few-Shot (Backend — `translate-api`)

**File**: `src/7_generate/utils/promptLoader.ts`

```typescript
export function loadFewshot(
  taskName: string,
  language?: string,
  fileName = "fewshot.json"
): ChatMessage[]
```

**Loading logic**:
1. Normalize language: `language?.split("-")[0] || "en"` → e.g., `"zh-CN"` → `"zh"`
2. Build candidate path: `resources/generate/<taskName>/<normalizedLang>/<fileName>`
3. Build fallback path: `resources/generate/<taskName>/en/<fileName>`
4. Try candidate → fall back to English → fall back to empty `[]`
5. Cache by key: `"<taskName>:<normalizedLang>:<fileName>"`

Key detail: the third parameter `fileName` already allows custom file names, but no caller currently uses it beyond the default `"fewshot.json"`.

**Synchronous** (`fs.readFileSync`), with in-memory `Map<string, ChatMessage[]>` cache.

### 1.4 How `promptLoader` Loads Few-Shot (Frontend — `tapword-translator`)

**File**: `src/8_generate/utils/promptLoader.ts`

```typescript
export async function loadFewshot(
  taskName: string,
  language?: string
): Promise<ChatMessage[]>
```

**Loading logic** — functionally identical to backend:
1. Normalize language: `language?.split("-")[0] || "en"` → `"zh"`
2. Build candidate URL: `chrome.runtime.getURL("resources/8_generate/<taskName>/<normalizedLang>/fewshot.json")`
3. Fallback URL: `.../<taskName>/en/fewshot.json`
4. Try candidate → fall back to English → fall back to empty `[]`
5. Cache by key: `"<taskName>:<normalizedLang>"`

**Async** (uses `fetch()` for `chrome.runtime` URLs), with in-memory `Map<string, ChatMessage[]>` cache.

**Key difference from backend**: The frontend `loadFewshot` does NOT have the `fileName` override parameter. It always loads `fewshot.json`.

### 1.5 How Few-Shot Is Passed to LLM

Both projects spread few-shot messages between system and user messages:

```typescript
// Backend — exampleGeneration.service.ts
function buildMessages(request): ChatMessage[] {
    const fewshotMessages = promptLoader.loadFewshot(TASK_NAME, "en")
    return [
        { role: "system", content: systemPrompt },
        ...fewshotMessages,
        { role: "user", content: userContent },
    ]
}
```

The `GenerationLLMService.generate(messages)` / `OpenAICompatibleClient.generate(messages)` pass the full `ChatMessage[]` array directly to the OpenAI-compatible API.

### 1.6 Current Auto-Candidates Status

**Neither** the backend nor frontend auto-candidates services currently load any few-shot examples. Both call `buildMessages()` with only `[system, user]` — no few-shot injection.

- Backend `autoCandidates.service.ts`: `buildMessages()` returns `[system, user]` only.
- Frontend `AutoCandidatesGenerationService.ts`: `buildMessages()` returns `[system, user]` only.

### 1.7 Auto-Candidates `userLevel` Values

The `AutoCandidatesRequest.userLevel` field is a union type:

```typescript
userLevel: "Beginner" | "Intermediate" | "Advanced"
```

This value is currently only rendered into the user prompt template via `${userLevel}` and used as a textual signal to the LLM.

---

## 2. Design Options Analysis

### 2.1 Option A — Separate Files Per Level

```
auto_candidates/
  zh/
    fewshot_beginner.json
    fewshot_intermediate.json
    fewshot_advanced.json
  en/
    fewshot_beginner.json
    fewshot_intermediate.json
    fewshot_advanced.json
```

**Pros**: Each file is small and focused; easy to edit independently; existing `loadFewshot` already supports `fileName` override (backend).
**Cons**: File proliferation (3 × N languages); frontend `loadFewshot` needs `fileName` parameter added; cache key needs updating.

### 2.2 Option B — Single File With Level Key

```json
{
  "beginner": [ { "role": "user", ... }, { "role": "assistant", ... } ],
  "intermediate": [ ... ],
  "advanced": [ ... ]
}
```

**Pros**: One file per language; no file proliferation.
**Cons**: Breaks the established flat-array `ChatMessage[]` format; every existing consumer would need a new parsing path; cache strategy becomes more complex; harder to test individual levels.

### 2.3 Option C — Directory Structure Per Level

```
auto_candidates/
  beginner/
    zh/
      fewshot.json
    en/
      fewshot.json
  intermediate/
    zh/
      fewshot.json
    en/
      fewshot.json
  advanced/
    zh/
      fewshot.json
    en/
      fewshot.json
```

**Pros**: Clean separation; default `fewshot.json` name preserved.
**Cons**: Deep nesting 3 levels; requires `taskName` mangling (e.g., `auto_candidates/beginner`); conceptually icky — level is not a "sub-task".

### 2.4 Option D — Modify `loadFewshot` to Accept Optional Level Parameter

Extend the existing `loadFewshot` signature to optionally accept a level suffix, composing the filename internally:

```typescript
// Backend
loadFewshot(taskName, language, fileName?)  // already has fileName param
// Caller: loadFewshot("auto_candidates", "zh", "fewshot_beginner.json")

// Frontend — needs new param
loadFewshot(taskName, language?, fileName?)
// Caller: loadFewshot("auto_candidates", "zh", "fewshot_beginner.json")
```

**Pros**: Minimal API change; reuses existing `loadFewshot` logic; no deep nesting; keeps flat-array format.
**Cons**: Callers must construct the filename.

### 2.5 Chosen Approach: Option A + D Hybrid

**Use separate files per level (Option A), loaded via the existing `fileName` parameter (Option D).**

**Rationale:**
1. **Preserves the flat `ChatMessage[]` format** — no JSON structure change, no new parser.
2. **Backend already supports it** — the `fileName` parameter in `loadFewshot` is already implemented but unused.
3. **Frontend requires only a minor change** — add the optional `fileName` parameter to the frontend `loadFewshot`.
4. **Each level's examples are independently editable** — important because the examples differ significantly in vocabulary difficulty and candidate count.
5. **Consistent with existing naming** — just a filename variation, not a structural change.

---

## 3. Proposed Design

### 3.1 File Naming Convention

```
resources/generate/auto_candidates/           # Backend root
resources/8_generate/auto_candidates/         # Frontend root
  <lang>/
    fewshot_beginner.json
    fewshot_intermediate.json
    fewshot_advanced.json
```

Concrete example (backend):
```
resources/generate/auto_candidates/
  zh/
    fewshot_beginner.json       # Beginner few-shot examples (en → zh)
    fewshot_intermediate.json   # Intermediate few-shot examples (en → zh)
    fewshot_advanced.json       # Advanced few-shot examples (en → zh)
  system_prompt.txt
  user_prompt_template.txt
```

Concrete example (frontend):
```
resources/8_generate/auto_candidates/
  zh/
    fewshot_beginner.json
    fewshot_intermediate.json
    fewshot_advanced.json
  system_prompt.txt
  user_prompt_template.txt
```

### 3.2 File Name Composition

The service composes the filename from the `userLevel` field:

```typescript
const LEVEL_TO_FEWSHOT_FILE: Record<string, string> = {
    Beginner: "fewshot_beginner.json",
    Intermediate: "fewshot_intermediate.json",
    Advanced: "fewshot_advanced.json",
}

// Usage
const fileName = LEVEL_TO_FEWSHOT_FILE[request.userLevel] ?? "fewshot_intermediate.json"
const fewshotMessages = promptLoader.loadFewshot(TASK_NAME, request.targetLang, fileName)
```

The default fallback is `fewshot_intermediate.json` if `userLevel` is somehow unrecognized.

### 3.3 Changes to Backend `promptLoader.ts`

**No changes required.** The backend `loadFewshot` already accepts an optional `fileName` parameter:

```typescript
export function loadFewshot(
  taskName: string,
  language?: string,
  fileName = "fewshot.json"   // ← already exists
): ChatMessage[]
```

The existing cache key includes `fileName`: `"<taskName>:<normalizedLang>:<fileName>"`.

### 3.4 Changes to Frontend `promptLoader.ts`

Add the optional `fileName` parameter (matching the backend signature):

```typescript
// BEFORE
export async function loadFewshot(
  taskName: string,
  language?: string
): Promise<ChatMessage[]>

// AFTER
export async function loadFewshot(
  taskName: string,
  language?: string,
  fileName: string = constants.PROMPT_FILE_FEWSHOT   // "fewshot.json"
): Promise<ChatMessage[]>
```

Changes inside the function:
1. Update `cacheKey` to include `fileName`: `"<taskName>:<normalizedLang>:<fileName>"`
2. Use `fileName` instead of hardcoded `constants.PROMPT_FILE_FEWSHOT` when building URLs

### 3.5 Changes to Backend `autoCandidates.service.ts`

Add few-shot loading to `buildMessages()`:

```typescript
// BEFORE
function buildMessages(request: AutoCandidatesRequest, effectiveLimit: number): ChatMessage[] {
    const userContent = buildUserPrompt(request, effectiveLimit)
    return [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
    ]
}

// AFTER
const LEVEL_TO_FEWSHOT_FILE: Record<string, string> = {
    Beginner: "fewshot_beginner.json",
    Intermediate: "fewshot_intermediate.json",
    Advanced: "fewshot_advanced.json",
}
const DEFAULT_FEWSHOT_FILE = "fewshot_intermediate.json"

function buildMessages(request: AutoCandidatesRequest, effectiveLimit: number): ChatMessage[] {
    const userContent = buildUserPrompt(request, effectiveLimit)
    const fewshotFile = LEVEL_TO_FEWSHOT_FILE[request.userLevel] ?? DEFAULT_FEWSHOT_FILE
    const fewshotMessages = promptLoader.loadFewshot(TASK_NAME, request.targetLang, fewshotFile)
    return [
        { role: "system", content: systemPrompt },
        ...fewshotMessages,
        { role: "user", content: userContent },
    ]
}
```

### 3.6 Changes to Frontend `AutoCandidatesGenerationService.ts`

Add few-shot loading to `buildMessages()`:

```typescript
// BEFORE
private buildMessages(params: AutoCandidatesRequestData, effectiveLimit: number): ChatMessage[] {
    const userPrompt = this.buildUserPrompt(params, effectiveLimit)
    return [
        { role: "system" as const, content: this.systemPrompt! },
        { role: "user" as const, content: userPrompt },
    ]
}

// AFTER
private static readonly LEVEL_TO_FEWSHOT_FILE: Record<string, string> = {
    Beginner: "fewshot_beginner.json",
    Intermediate: "fewshot_intermediate.json",
    Advanced: "fewshot_advanced.json",
}
private static readonly DEFAULT_FEWSHOT_FILE = "fewshot_intermediate.json"

private fewshotMessages: ChatMessage[] = []

// Add to initialize():
async initialize(): Promise<void> {
    // ... existing prompt loading ...
    // Note: fewshot is loaded per-request, not at init time,
    // because level varies per request. See buildMessages().
}

private async buildMessages(
    params: AutoCandidatesRequestData,
    effectiveLimit: number
): Promise<ChatMessage[]> {
    const userPrompt = this.buildUserPrompt(params, effectiveLimit)
    const fewshotFile =
        AutoCandidatesGenerationService.LEVEL_TO_FEWSHOT_FILE[params.userLevel]
        ?? AutoCandidatesGenerationService.DEFAULT_FEWSHOT_FILE
    const fewshotMessages = await promptLoaderModule.loadFewshot(
        constants.TASK_AUTO_CANDIDATES,
        params.targetLang,
        fewshotFile
    )
    return [
        { role: "system" as const, content: this.systemPrompt! },
        ...fewshotMessages,
        { role: "user" as const, content: userPrompt },
    ]
}
```

Note: `buildMessages` must become `async` because frontend `loadFewshot` is async. The caller (`generate()`) already awaits, so this is a straightforward change.

---

## 4. Few-Shot Content Design

### 4.1 Design Principles

Each few-shot example is a `{user, assistant}` pair where:
- **User content**: Matches the user prompt template format (sourceLang, targetLang, userLevel, limit, blockText)
- **Assistant content**: A valid JSON string matching the expected output format (`{ "candidates": [...] }`)

The examples must demonstrate:
1. **Level-appropriate selection** — the key differentiator between files
2. **Phrase-over-word preference** — combined-meaning expressions preferred over individual words
3. **Proper `reason→text→type→translation` field order** — Chain-of-Thought format
4. **Under-selection principle** — not using the full limit budget
5. **Contextually accurate translations**

### 4.2 Shared Block Text for Examples

To make the level differences starkly clear, use **the same block text** across all three level files, with different candidate selections.

**Recommended block text for few-shot (English → Chinese):**

> "The architect's meticulous attention to detail was evident in every facet of the building's design, from the ornate cornice work to the subtle interplay of natural light and shadow that permeated the grand foyer."

### 4.3 Beginner Level (`fewshot_beginner.json`)

**Philosophy**: Cast a wide net. Include relatively common vocabulary that non-native readers may not know, plus recognizable phrases. Higher candidate count (closer to the limit).

```json
[
  {
    "role": "user",
    "content": "# Source Language\nen\n\n# Target Language\nzh\n\n# Reader Proficiency Level\nBeginner\n\n# Maximum Translation Results\n5\n\n# Block Text\nThe architect's meticulous attention to detail was evident in every facet of the building's design, from the ornate cornice work to the subtle interplay of natural light and shadow that permeated the grand foyer.\n"
  },
  {
    "role": "assistant",
    "content": "{\"candidates\":[{\"reason\":\"Beginner readers may not know this adjective meaning extremely careful and precise\",\"text\":\"meticulous\",\"type\":\"word\",\"translation\":\"一丝不苟的\"},{\"reason\":\"'attention to detail' is a common collocation that beginners may not parse as a unit\",\"text\":\"attention to detail\",\"type\":\"phrase\",\"translation\":\"对细节的关注\"},{\"reason\":\"Less common word meaning a particular aspect or side\",\"text\":\"facet\",\"type\":\"word\",\"translation\":\"方面\"},{\"reason\":\"Architectural term unlikely to be known at beginner level\",\"text\":\"ornate\",\"type\":\"word\",\"translation\":\"华丽的\"},{\"reason\":\"'interplay' is an abstract noun meaning interaction between elements\",\"text\":\"interplay\",\"type\":\"word\",\"translation\":\"相互作用\"}]}"
  }
]
```

**Characteristics**: 5 candidates (at limit), includes mid-frequency words like `meticulous` and phrases like `attention to detail`.

### 4.4 Intermediate Level (`fewshot_intermediate.json`)

**Philosophy**: Focus on mid-frequency vocabulary and phrases with non-obvious combined meanings. Moderate candidate count.

```json
[
  {
    "role": "user",
    "content": "# Source Language\nen\n\n# Target Language\nzh\n\n# Reader Proficiency Level\nIntermediate\n\n# Maximum Translation Results\n5\n\n# Block Text\nThe architect's meticulous attention to detail was evident in every facet of the building's design, from the ornate cornice work to the subtle interplay of natural light and shadow that permeated the grand foyer.\n"
  },
  {
    "role": "assistant",
    "content": "{\"candidates\":[{\"reason\":\"Architectural term for decorative molding along roofline — domain-specific\",\"text\":\"cornice\",\"type\":\"word\",\"translation\":\"檐口\"},{\"reason\":\"The phrase 'interplay of' combined with its objects forms a meaning that intermediate readers may miss\",\"text\":\"interplay\",\"type\":\"word\",\"translation\":\"相互作用\"},{\"reason\":\"'permeated' means spread throughout — less common verb at intermediate level\",\"text\":\"permeated\",\"type\":\"word\",\"translation\":\"弥漫\"}]}"
  }
]
```

**Characteristics**: 3 candidates (under limit), skips common words like `meticulous`/`ornate` that intermediate readers likely know.

### 4.5 Advanced Level (`fewshot_advanced.json`)

**Philosophy**: Only genuinely difficult, rare, or domain-specific terms. Very few candidates — the reader knows most words.

```json
[
  {
    "role": "user",
    "content": "# Source Language\nen\n\n# Target Language\nzh\n\n# Reader Proficiency Level\nAdvanced\n\n# Maximum Translation Results\n5\n\n# Block Text\nThe architect's meticulous attention to detail was evident in every facet of the building's design, from the ornate cornice work to the subtle interplay of natural light and shadow that permeated the grand foyer.\n"
  },
  {
    "role": "assistant",
    "content": "{\"candidates\":[{\"reason\":\"Architectural term for the horizontal decorative molding at the top of a building — highly domain-specific\",\"text\":\"cornice\",\"type\":\"word\",\"translation\":\"檐口\"}]}"
  }
]
```

**Characteristics**: 1 candidate (well under limit), only the most domain-specific term. Advanced readers know `meticulous`, `facet`, `ornate`, `interplay`, `permeated`, `foyer` — only `cornice` is genuinely niche.

### 4.6 Summary Table

| Level | Expected Density | Example Candidate Count | Typical Vocabulary |
|-------|-----------------|------------------------|--------------------|
| Beginner | High (at or near limit) | 4–5 | Common vocabulary, basic collocations, any word a non-native novice might not know |
| Intermediate | Moderate (50–70% of limit) | 2–3 | Mid-frequency words, phrasal verbs, non-obvious phrases |
| Advanced | Low (20–40% of limit) | 1–2 | Domain-specific terms, rare words, nuanced idioms |

---

## 5. File Changes List

### 5.1 Backend — `translate-api`

| Action | File Path | Description |
|--------|-----------|-------------|
| **No change** | `src/7_generate/utils/promptLoader.ts` | Already supports `fileName` parameter |
| **Modify** | `src/7_generate/services/autoCandidates.service.ts` | Add `LEVEL_TO_FEWSHOT_FILE` mapping, inject fewshot into `buildMessages()` |
| **Create** | `resources/generate/auto_candidates/zh/fewshot_beginner.json` | Beginner few-shot examples (en→zh) |
| **Create** | `resources/generate/auto_candidates/zh/fewshot_intermediate.json` | Intermediate few-shot examples (en→zh) |
| **Create** | `resources/generate/auto_candidates/zh/fewshot_advanced.json` | Advanced few-shot examples (en→zh) |

### 5.2 Frontend — `tapword-translator`

| Action | File Path | Description |
|--------|-----------|-------------|
| **Modify** | `src/8_generate/utils/promptLoader.ts` | Add optional `fileName` parameter to `loadFewshot()` |
| **Modify** | `src/8_generate/services/AutoCandidatesGenerationService.ts` | Add `LEVEL_TO_FEWSHOT_FILE` mapping, inject fewshot into `buildMessages()`, make `buildMessages` async |
| **Create** | `resources/8_generate/auto_candidates/zh/fewshot_beginner.json` | Beginner few-shot examples (en→zh) — same content as backend |
| **Create** | `resources/8_generate/auto_candidates/zh/fewshot_intermediate.json` | Intermediate few-shot examples (en→zh) — same content as backend |
| **Create** | `resources/8_generate/auto_candidates/zh/fewshot_advanced.json` | Advanced few-shot examples (en→zh) — same content as backend |
| **Modify** | `manifest.json` | Add `resources/8_generate/auto_candidates/zh/*` to `web_accessible_resources` if not already covered |

### 5.3 Shared — Fewshot Content Files

The fewshot JSON files are **identical** between backend and frontend. They can be maintained in one place and copied, or shared via a symlink/build step. For V1, manual duplication is acceptable given the small file count (3 files).

---

## 6. Impact Analysis

### 6.1 Both Projects — Mechanism Similarity

The fewshot loading mechanism is **functionally identical** between backend and frontend:
- Same directory convention: `<taskName>/<lang>/fewshot.json`
- Same flat `ChatMessage[]` array format
- Same language fallback logic (target lang → English → empty)
- Same caching strategy (in-memory map)

The only differences are:
1. Backend is synchronous (`fs.readFileSync`); frontend is async (`fetch`)
2. Backend `loadFewshot` already has `fileName` param; frontend does not (yet)

**Conclusion**: The solution works cleanly for both projects with minimal adaptation.

### 6.2 Backward Compatibility

- **Existing tasks** (word_translation, example_sentence, dictionary_summary): Completely unaffected. They continue using `loadFewshot(taskName, lang)` with the default `"fewshot.json"`.
- **Auto-candidates without fewshot**: If the target language directory doesn't exist yet, `loadFewshot` falls back to English, then to empty `[]`. This means the service continues to work even without fewshot files — graceful degradation.

### 6.3 Token Cost Impact

Each fewshot file adds 1 `{user, assistant}` pair (in this spec). Estimated token increase:
- User prompt example: ~100–150 tokens
- Assistant response example: ~100–200 tokens
- **Total per request**: ~200–350 additional tokens

This is modest and well within the `LLM_MAX_TOKENS = 2000` output budget. The total prompt size (system + fewshot + user) remains under typical context window limits.

### 6.4 Context Cache Optimization

LLM providers (Qwen, OpenAI) cache repeated prompt prefixes. Since the system prompt + fewshot examples are static for a given level:
- **Same-level requests share cache** — after the first request, subsequent requests with the same level hit context cache
- **Different levels have different prefixes** — 3 possible cache slots per language

---

## 7. Verification Plan

### 7.1 Unit Tests

| Test | Project | Description |
|------|---------|-------------|
| `loadFewshot` with custom `fileName` | Backend | Verify `loadFewshot("auto_candidates", "zh", "fewshot_beginner.json")` loads the correct file |
| `loadFewshot` with custom `fileName` | Frontend | Same test, async variant |
| `loadFewshot` fallback chain | Both | Verify: target lang file exists → loads it; target lang missing → falls back to English; English missing → returns `[]` |
| Cache key includes `fileName` | Both | Verify that `loadFewshot(task, "zh", "fewshot_beginner.json")` and `loadFewshot(task, "zh", "fewshot_advanced.json")` return different results |
| `buildMessages` includes fewshot | Backend | Mock `loadFewshot`, verify returned messages array contains `[system, ...fewshot, user]` |
| `buildMessages` includes fewshot | Frontend | Same test, async |
| Level mapping | Both | Verify `LEVEL_TO_FEWSHOT_FILE["Beginner"]` → `"fewshot_beginner.json"`, etc. |
| Unknown level fallback | Both | Verify unrecognized `userLevel` falls back to `fewshot_intermediate.json` |

### 7.2 Integration Tests

| Test | Description |
|------|-------------|
| Beginner produces more candidates | Send a request with `userLevel: "Beginner"` and verify candidate count is higher than `Advanced` for the same block text |
| Advanced produces fewer candidates | Send a request with `userLevel: "Advanced"` and verify candidate count is lower |
| Fewshot not found gracefully degrades | Remove fewshot files, verify the service still returns valid (possibly less accurate) results |

### 7.3 Manual Verification

1. **Backend**: Run `npm run build` → verify compilation succeeds
2. **Frontend**: Run `npm run build` → verify compilation succeeds; check `dist/` includes the new fewshot JSON files
3. **End-to-end**: Use the extension on an English article, verify:
   - Beginner mode shows more translation annotations
   - Advanced mode shows fewer, more specialized annotations
   - Intermediate is between the two

### 7.4 Fewshot Quality Iteration

After initial deployment, iterate on fewshot content based on real-world output quality:
1. Collect sample outputs → evaluate if the LLM follows the level-appropriate density pattern
2. Adjust fewshot examples if the LLM over- or under-selects
3. Consider adding a second fewshot pair per level for additional guidance

---

## 8. Future Extensions

### 8.1 More Languages

As the feature expands to other language pairs, add level-specific fewshot files under new language directories:
```
auto_candidates/
  zh/
    fewshot_beginner.json
    fewshot_intermediate.json
    fewshot_advanced.json
  ja/
    fewshot_beginner.json
    fewshot_intermediate.json
    fewshot_advanced.json
```

### 8.2 Multi-Example Fewshot

Each file currently contains 1 example pair. If 1 example is insufficient for consistent output quality, add 2–3 pairs per file. The format supports this naturally — just append more `{user, assistant}` pairs to the array.

### 8.3 Programmatic Level Mapping

If future requirements add more levels (e.g., "Elementary", "Upper-Intermediate"), the `LEVEL_TO_FEWSHOT_FILE` mapping scales linearly — just add entries and create corresponding files.
