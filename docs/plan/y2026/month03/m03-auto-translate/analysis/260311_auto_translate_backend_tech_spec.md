# Auto-Translation Backend Technical Spec

*Created: 2026-03-11*
*Revised: 2026-03-11 — Architecture review changes (see Revision History)*
*Status: Complete*
*Author: AI Agent (codebase-derived)*

### Revision History

| Date | Changes |
|------|--------|
| 2026-03-11 | Initial version |
| 2026-03-11 | Architecture review: (1) `manualTrigger`/`excludedTexts` removed from LLM prompt — kept in API request for backend pipeline filtering only, (2) LLM no longer outputs offsets — backend computes them deterministically, (3) LLM output field order changed to text→type→reason→translation (Chain-of-Thought optimization), (4) Backend computes offsets for all occurrences of each candidate text, (5) `reason` field stripped from API response — kept in LLM output for CoT quality and backend logging |
| 2026-03-11 | Design adjustments (second round): (7) Selection rules expanded to guide LLM toward recognizing familiar-word combinations (e.g., "once per", "break down") — not just individual unknown words, (8) Prompt uses "translation results" instead of "candidates" to avoid single-word bias; dynamic budget now factors in `userLevel`, (9) `reason` field moved to FIRST position in LLM output (`reason→text→type→translation`) to maximize Chain-of-Thought quality |

## Document Purpose

This document is a self-contained technical specification for the backend API required by the **Automatic Word/Phrase Translation** feature. It was produced by reverse-engineering frontend needs from the finalized requirements and by analyzing the existing codebase architecture — specifically `src/5_backend/`, `src/6_translate/`, `src/8_generate/`, and `src/2_background/`.

---

## 1. Current Architecture Analysis

### 1.1 Backend Infrastructure Layer (`src/5_backend/`)

The extension communicates with cloud services through a centralized `APIService` class.

**Key patterns:**

| Pattern | Detail |
|---------|--------|
| HTTP client | `APIService.request<TResponse, TBody>(endpoint, method, body, options)` — generic, type-safe |
| Response wrapper | `APIResponse<T>` = `{ data: T \| null, code: number, message: string }` |
| Success indicator | `code === 0` |
| Error model | `APIError` discriminated union: `businessError`, `requestError`, `rateLimited`, `timeout`, `tokenExpired`, etc. |
| Convenience functions | `post<TResponse>(endpoint, body)`, `get<TResponse>(endpoint)` — delegate to singleton `APIService` |
| Authentication | JWT Bearer token attached by default; auto-refresh on 419 |
| Fallback | Automatic base URL fallback with probe on network/WAF errors |

**Response envelope convention (from `other/api文档/0.backend_api_conventions.md`):**
```json
{
  "data": { /* typed payload */ },
  "code": 0,
  "message": "success"
}
```
Errors use non-zero `code` with `data: null`. HTTP status codes are used for auth/transport errors, while business logic errors use HTTP 200 + non-zero code.

### 1.2 Translation Business Logic Layer (`src/6_translate/`)

Two primary functions are exported: `translateWord()` and `translateFragment()`.

**Request flow (cloud path):**
1. `TranslationService.translateWord(params)` constructs a `TranslationApiRequest`
2. Calls `post<TranslationApiResponse>(TRANSLATION_API_ENDPOINTS.TRANSLATE, request)`
3. Returns typed `TranslationResult`

**Multi-provider routing:**
The `translateWord()` function switches on `userSettings.translationProvider`:
- `"official"` → cloud API via `post<T>()`
- `"customApi"` → local LLM via `8_generate/WordTranslationService`
- `"mtranserver"` → self-hosted MTranServer
- `"bingTranslate"` → Bing Translate

**Existing endpoints:**
- `POST /api/v1/translate` — single word, context-aware
- `POST /api/v1/translate/fragment` — multi-word phrase, context-aware

**Error handling:** `APIError` is caught and converted into `TranslationError` with i18n user-facing messages.

### 1.3 LLM Generation Layer (`src/8_generate/`)

Used for local (custom API) translation. Relevant architecture:

| Component | Role |
|-----------|------|
| `OpenAICompatibleClient` | Generic OpenAI-SDK wrapper, enforces `response_format: { type: "json_object" }` |
| `WordTranslationService` | Loads system+user prompt templates, builds chat messages, parses JSON response |
| `FragmentTranslationService` | Same pattern for phrase translation, selects prompt variant based on context availability |
| Prompt templates | Stored in `resources/8_generate/` as `.txt` files with `${variable}` placeholders |
| `templateRenderer` | Simple `${key}` → value substitution |
| `promptLoader` | Loads and caches prompt files from resources directory |

**Prompt architecture:**
- System prompt: defines the expert persona and output format rules
- User prompt template: structured sections rendered from request variables
- Few-shot examples (optional): loaded per source language

### 1.4 Background Message Routing (`src/2_background/`)

The background service worker mediates all content-script-to-backend communication.

**Flow:**
1. Content script sends `chrome.runtime.sendMessage({ type: "TRANSLATE_REQUEST", data: {...} })`
2. `MessageRouter.setupMessageListener()` dispatches by `message.type`
3. `TranslationRequestHandler.handleTranslationRequest()` calls `translateModule.translateWord()`
4. Response sent back via `sendResponse()`

**Message types (from `src/0_common/types/index.ts`):**
- `TRANSLATE_REQUEST` / `TRANSLATE_RESPONSE`
- `FRAGMENT_TRANSLATE_REQUEST` / `FRAGMENT_TRANSLATE_RESPONSE`
- `SPEECH_SYNTHESIS_REQUEST` / `SPEECH_SYNTHESIS_RESPONSE`
- `PAGE_ACTIVATED`, `POPUP_BOOTSTRAP_REQUEST`

Each message type has strongly-typed request/response interfaces with discriminated `success: true | false`.

---

## 2. Frontend-to-Backend Communication Pattern

### 2.1 Existing Communication Flow

```
┌─────────────┐  chrome.runtime.sendMessage   ┌─────────────────┐  post<T>()   ┌──────────────┐
│   Content    │ ──────────────────────────────>│   Background    │ ────────────>│  Cloud API   │
│   Script     │ <──────────────────────────────│   Service       │ <────────────│  Server      │
│  (1_content) │        sendResponse()          │   Worker        │   APIResp    │              │
└─────────────┘                                 │  (2_background) │              └──────────────┘
                                                └─────────────────┘
                                                   ↓ also calls
                                                ┌─────────────────┐
                                                │  6_translate     │ ←→ 8_generate (local LLM)
                                                │  TranslationSvc  │
                                                └─────────────────┘
```

### 2.2 How Auto-Candidates Should Be Integrated

The new auto-candidates endpoint follows the exact same pattern:

1. **New message type**: `AUTO_CANDIDATES_REQUEST` / `AUTO_CANDIDATES_RESPONSE`
2. **New background handler**: `AutoCandidatesRequestHandler`
3. **New service function**: in `6_translate/` or a new sibling — calls `post<AutoCandidatesResponse>()`
4. **Cloud endpoint**: `POST /api/v1/translate/auto-candidates`

This is consistent with the existing pattern: every content-script API call goes through background message routing → business logic layer → cloud API (or local LLM variant).

---

## 3. New Auto-Candidates API Endpoint Design

### 3.1 Endpoint

```
POST /api/v1/translate/auto-candidates
```

Authenticated via JWT Bearer token (standard `Authorization` header).

### 3.2 Request Schema

```typescript
interface AutoCandidatesApiRequest {
  /** Source language code (e.g. "en") */
  sourceLang: string
  /** Target language code (e.g. "zh-CN") */
  targetLang: string
  /** Full raw text of the current block */
  blockText: string
  /** The word/phrase the user just manually translated.
   *  Used by backend hard-rule pipeline to exclude from results.
   *  NOT passed to LLM prompt (difficulty is calibrated by userLevel). */
  manualTrigger: {
    text: string
    type?: "word" | "phrase"
    translation?: string
  }
  /** User proficiency level — affects candidate difficulty threshold */
  userLevel: "Beginner" | "Intermediate" | "Advanced"
  /** Texts to exclude from candidate results (already translated items).
   *  Used by backend hard-rule pipeline only, NOT passed to LLM prompt. */
  excludedTexts?: string[]
  /** Frontend budget hint (max translation results desired) */
  limit?: number
}
```

**Example request:**
```json
{
  "sourceLang": "en",
  "targetLang": "zh-CN",
  "blockText": "The proposal was met with skepticism, but the entrepreneur's tenacity and her innovative approach to sustainable energy eventually won over the most ardent critics.",
  "manualTrigger": {
    "text": "skepticism",
    "type": "word",
    "translation": "怀疑态度"
  },
  "userLevel": "Intermediate",
  "excludedTexts": ["skepticism"],
  "limit": 3
}
```

### 3.3 Response Schema

```typescript
interface AutoCandidatesApiResponse {
  traceId: string
  candidates: AutoCandidate[]
  meta: {
    sourceLang: string
    targetLang: string
    limitApplied: number
    degraded: boolean
    model?: string
  }
  warnings?: string[]
}

interface AutoCandidate {
  /** Exact text as it appears in blockText */
  text: string
  /** Candidate granularity */
  type: "word" | "phrase"
  /** Start offset in blockText (0-based, inclusive). Computed by backend, not LLM. */
  start: number
  /** End offset in blockText (0-based, exclusive). Computed by backend, not LLM. */
  end: number
  /** Translation in target language */
  translation: string
  /** Selection source */
  source: "llm" | "rule" | "hybrid"
  // NOTE: `reason` is intentionally excluded from the API response.
  // The LLM produces a `reason` field (for Chain-of-Thought quality),
  // and the backend logs it for debugging, but it is stripped before
  // sending the response to the frontend.
}
```

**Example response:**
```json
{
  "data": {
    "traceId": "req_auto_abc123",
    "candidates": [
      {
        "text": "tenacity",
        "type": "word",
        "start": 62,
        "end": 70,
        "translation": "坚韧",
        "source": "llm"
      },
      {
        "text": "won over",
        "type": "phrase",
        "start": 119,
        "end": 127,
        "translation": "说服了",
        "source": "llm"
      },
      {
        "text": "ardent",
        "type": "word",
        "start": 137,
        "end": 143,
        "translation": "热烈的",
        "source": "llm"
      }
    ],
    "meta": {
      "sourceLang": "en",
      "targetLang": "zh-CN",
      "limitApplied": 3,
      "degraded": false,
      "model": "gpt-4o-mini"
    },
    "warnings": []
  },
  "code": 0,
  "message": "success"
}
```

### 3.4 Offset Convention

- `start` is 0-based **inclusive**, `end` is 0-based **exclusive** (consistent with JavaScript `String.prototype.substring()`).
- Offsets are character-based against the exact `blockText` string submitted in the request.
- Offsets are **computed by the backend** (not by the LLM). The backend uses `blockText.indexOf(candidate.text)` to deterministically find all occurrences and compute offsets.
- Backend MUST verify that `blockText.substring(start, end) === text` for every returned candidate.

### 3.5 Response Envelope

Follows the project-wide convention:
```json
{ "data": { /* AutoCandidatesApiResponse */ }, "code": 0, "message": "success" }
```

Error responses follow the same convention:
```json
{ "data": null, "code": 20600, "message": "Auto-candidate identification failed" }
```

---

## 4. LLM Prompt Design Strategy

### 4.1 Prompt Architecture

Following the established `8_generate` pattern, the auto-candidates feature should use:
- **System prompt**: defines the expert persona and strict output format
- **User prompt template**: renders request variables into structured sections

### 4.2 System Prompt Design

```
You are an expert reading comprehension assistant. Your task is to identify words and phrases in a text block that would most help a reader continue reading smoothly.

## Core Task
Given a block of text and the reader's language proficiency level, identify words or phrases in the block that:
1. Are likely comprehension blockers for a reader at the given proficiency level
2. Are most important for maintaining reading flow
3. Would benefit from translation to help the reader continue without interruption

## Output Format
Output strictly in the following JSON format:
```json
{
  "candidates": [
    {
      "reason": "brief explanation of what comprehension gap this fills",
      "text": "exact text from block",
      "type": "word or phrase",
      "translation": "translation in target language"
    }
  ]
}
```

Field order matters: output `reason` as the VERY FIRST field in each candidate object. The LLM first reasons about the comprehension gap, then identifies the specific word/phrase, then classifies it, then translates it. This ordering maximizes Chain-of-Thought quality because autoregressive generation means earlier reasoning improves all subsequent fields.

## Selection Rules

### What to select
- Words or multi-word combinations that would block reading comprehension
  for a reader at the specified level. This includes:
  - Individual unfamiliar words
  - Combinations of familiar words that form an unfamiliar expression
    (e.g., "once per", "break down", "in terms of", "as opposed to")
  - Phrasal verbs, idioms, and collocations where the combined meaning
    differs significantly from the individual words
- Vocabulary that is critical for understanding the paragraph's main idea

### What to skip
- Common function words (the, is, a, etc.)
- Words that are obvious cognates or easy to infer from context
- Punctuation, numbers, URLs, symbols
- Words/phrases with no stable standalone meaning in this context

### Phrase-over-word preference
- When a multi-word phrase has a distinct combined meaning, prefer the phrase over separate word candidates
- If selecting a phrase, do NOT also select individual words within that phrase

### Quantity control
- Provide at most {limit} translation results
- Prefer under-selection over over-selection
- A {userLevel} reader should find these genuinely helpful

## Quality Standards
- ✅ Output pure JSON, parseable by JSON.parse()
- ✅ Every candidate text must exist verbatim in the block text
- ✅ Translations must be contextually accurate
- ✅ No explanations or text outside the JSON object

## Critical Errors to Avoid
- ❌ Do NOT return overlapping word+phrase results for the same span
- ❌ Do NOT fabricate text that does not appear in the block
- ❌ Do NOT return more translation results than the limit
```

### 4.3 User Prompt Template

```
# Source Language
${sourceLang}

# Target Language
${targetLang}

# Reader Proficiency Level
${userLevel}

# Maximum Candidates
${limit}

# Block Text
${blockText}
```

### 4.4 Prompt Design Rationale

| Design Choice | Reason |
|---------------|--------|
| `userLevel` in prompt | Directly affects selection threshold and result count — Beginner sees more common words with higher budget, Advanced sees fewer and rarer terms |
| Strict JSON format | Enables reliable parsing; consistent with existing `8_generate` pattern |
| `reason` as first field (CoT) | Chain-of-Thought: `reason→text→type→translation` ordering — the LLM first reasons about the comprehension gap, then identifies the word/phrase, then classifies it, then translates. Autoregressive generation means earlier reasoning improves all subsequent fields |
| `reason` field required but stripped | Forces LLM to justify selection (improving output quality); logged for debugging; stripped from API response to minimize payload |
| No offsets in LLM output | Offsets are computed deterministically by backend (`blockText.indexOf`); eliminates a major source of LLM errors |
| No `manualTrigger`/`excludedTexts` in prompt | Difficulty calibration handled by `userLevel`; exclusion handled by backend pipeline post-filtering |
| Phrase-over-word instruction | Encodes the product rule directly in prompt to reduce post-processing burden |

### 4.5 Few-Shot Examples (Optional Enhancement)

Following the WordTranslationService pattern that loads `fewshot.json` per source language, the auto-candidates prompt could optionally include 1-2 few-shot examples demonstrating:
- Phrase-over-word selection
- Level-appropriate candidate selection
- Proper JSON output format (with reason-first field order: `reason→text→type→translation`)

---

## 5. Hard-Rule Filtering Pipeline

Backend MUST NOT pass raw LLM output to frontend. A post-processing pipeline normalizes and filters results.

### 5.1 Pipeline Stages

```
LLM Raw Output
    │
    ▼
Stage 1: Parse JSON
    │  ✗ → degrade to empty
    ▼
Stage 2: Validate candidate structure
    │  (must have reason, text, type, translation)
    │  ✗ → drop invalid candidates
    ▼
Stage 3: Compute offsets & expand occurrences
    │  For each candidate, find ALL occurrences of text in blockText
    │  Each occurrence → separate entry with computed start/end
    │  Validate: blockText.substring(start, end) === text
    │  ✗ (text not found) → drop candidate
    ▼
Stage 4: Remove excluded items
    │  case-insensitive match against excludedTexts[] AND manualTrigger.text
    ▼
Stage 5: Remove noise tokens
    │  punctuation, pure numbers, URLs, symbols, single-char fragments
    ▼
Stage 6: Remove duplicates
    │  by normalized text (case-insensitive, trimmed)
    ▼
Stage 7: Apply phrase-over-word precedence
    │  if phrase [start,end) fully contains word [start,end), drop word
    ▼
Stage 8: Rank by priority
    │  order preserved from LLM output (LLM returns in priority order)
    ▼
Stage 9: Enforce capped upper bound
    │  truncate to min(limit, CAPPED_UPPER_BOUND)
    │  NOTE: candidate count may have expanded in Stage 3 (multiple occurrences)
    ▼
Stage 10: Strip reason field
    │  Remove `reason` from each candidate before response
    │  Log `reason` for debugging/analytics
    ▼
Normalized Candidate List
```

### 5.2 Offset Computation & Occurrence Expansion (Stage 3)

Since the LLM does not output offsets, the backend computes them deterministically:

1. For each LLM candidate, find **all** occurrences of `candidate.text` in `blockText` using string matching
2. For each occurrence, compute `start` (inclusive) and `end` (exclusive) offsets
3. Each occurrence becomes a **separate** candidate entry with computed offsets — e.g., if `"tenacity"` appears 3 times in the block, one LLM candidate becomes 3 response entries (each with its own offset pair)
4. Validate: `blockText.substring(start, end) === candidate.text` for each computed offset
5. If `candidate.text` is not found in `blockText` at all, drop the candidate entirely

```typescript
// Pseudocode
function expandOccurrences(candidate: LLMCandidate, blockText: string): AutoCandidate[] {
  const results: AutoCandidate[] = []
  let searchFrom = 0
  while (true) {
    const start = blockText.indexOf(candidate.text, searchFrom)
    if (start === -1) break
    const end = start + candidate.text.length
    results.push({ ...candidate, start, end })
    searchFrom = start + 1
  }
  return results
}
```

### 5.3 Phrase-Over-Word Precedence (Stage 7)

```typescript
// Pseudocode
for (const word of candidates.filter(c => c.type === 'word')) {
  const overlappingPhrase = candidates.find(c =>
    c.type === 'phrase' &&
    c.start <= word.start &&
    c.end >= word.end
  );
  if (overlappingPhrase) {
    markForRemoval(word);
  }
}
```

### 5.4 Capped Upper Bound

The agreed capped upper bound should be a server-side constant (recommended: `MAX_AUTO_CANDIDATES = 5`). Regardless of the `limit` field in the request, the server never returns more than `MAX_AUTO_CANDIDATES`.

Dynamic budget calculation:
```
effectiveLimit = min(request.limit ?? MAX_AUTO_CANDIDATES, MAX_AUTO_CANDIDATES)
```

Note: After Stage 3 (Occurrence Expansion), the candidate count may exceed the original LLM output count. The capped upper bound is applied **after** expansion, so the total response entries are still bounded.

---

## 6. Degradation Strategy

### 6.1 Degrade-to-Empty Principle

This endpoint is an **enhancement** feature. When quality is uncertain, return empty rather than noisy results.

### 6.2 Degradation Conditions

| Condition | Behavior |
|-----------|----------|
| LLM timeout | Return `candidates: []`, `meta.degraded: true` |
| LLM output unparseable | Return `candidates: []`, `meta.degraded: true` |
| All candidates filtered out | Return `candidates: []`, `meta.degraded: false` (normal filtering) |
| `blockText` too short (<20 chars) | Return `candidates: []` immediately (skip LLM call) |
| `blockText` too long (>5000 chars) | Truncate to first 5000 chars before LLM call |
| Rate limited | Return HTTP 429 |
| Model error | Return `candidates: []`, `meta.degraded: true` |

### 6.3 Never-Fail Guarantee

The auto-candidates endpoint must never cause a cascade failure that affects the manual translation flow. The frontend calls this endpoint asynchronously after manual translation success; a failure here should be invisible to the user.

---

## 7. Error Handling

### 7.1 Error Response Mapping

Following project conventions:

| Scenario | HTTP Status | Response Code | data |
|----------|-------------|---------------|------|
| Success | 200 | 0 | Candidate payload |
| Validation error (missing fields) | 400 | 400 | null |
| Auth failure | 401 | 401 | null |
| Rate limited | 429 | 429 | null |
| LLM degradation (timeout, parse fail) | 200 | 0 | `candidates: []`, `meta.degraded: true` |
| Content moderation blocked | 200 | 20001 | null |
| Upstream model error | 200 | 20600 | null |
| Server internal error | 500 | 500 | null |

### 7.2 Suggested New Business Error Codes

| Code | Message |
|------|---------|
| 20600 | Auto-candidate identification failed |
| 20601 | Block text exceeds maximum allowed length |

### 7.3 Frontend Error Handling

The frontend should handle all non-success responses by silently abandoning the auto-flow:
```typescript
// Pseudocode in background handler
try {
  const result = await post<AutoCandidatesApiResponse>(endpoint, request)
  sendResponse({ type: "AUTO_CANDIDATES_RESPONSE", success: true, data: result })
} catch (error) {
  // Silent degradation — do NOT propagate to manual translation flow
  sendResponse({ type: "AUTO_CANDIDATES_RESPONSE", success: true, data: { candidates: [], meta: { degraded: true } } })
}
```

---

## 8. Integration Plan

### 8.1 New Files (Frontend Extension Side)

Following the existing module structure:

**`src/0_common/types/index.ts`** — Add:
```typescript
// New message types
export type MessageType = ... | "AUTO_CANDIDATES_REQUEST"

export interface AutoCandidatesRequestMessage {
  type: "AUTO_CANDIDATES_REQUEST"
  data: {
    sourceLang: string
    targetLang: string
    blockText: string
    manualTrigger: { text: string; type?: "word" | "phrase"; translation?: string }
    userLevel: "Beginner" | "Intermediate" | "Advanced"
    excludedTexts: string[]
    limit: number
  }
}

export interface AutoCandidatesResponseSuccessMessage {
  type: "AUTO_CANDIDATES_RESPONSE"
  success: true
  data: {
    traceId: string
    candidates: Array<{
      text: string
      type: "word" | "phrase"
      start: number
      end: number
      translation: string
      source: "llm" | "rule" | "hybrid"
    }>
    meta: {
      sourceLang: string
      targetLang: string
      limitApplied: number
      degraded: boolean
      model?: string
    }
    warnings?: string[]
  }
}

export interface AutoCandidatesResponseErrorMessage {
  type: "AUTO_CANDIDATES_RESPONSE"
  success: false
  error: string
}

export type AutoCandidatesResponseMessage =
  | AutoCandidatesResponseSuccessMessage
  | AutoCandidatesResponseErrorMessage
```

**`src/6_translate/constants/TranslationConstants.ts`** — Add:
```typescript
export const TRANSLATION_API_ENDPOINTS = {
  TRANSLATE: "/api/v1/translate",
  TRANSLATE_FRAGMENT: "/api/v1/translate/fragment",
  AUTO_CANDIDATES: "/api/v1/translate/auto-candidates",  // NEW
} as const
```

**`src/6_translate/types/TranslationApiTypes.ts`** — Add request/response types for auto-candidates.

**`src/6_translate/services/AutoCandidatesService.ts`** — New service:
```typescript
import { post } from "@/5_backend"
import { TRANSLATION_API_ENDPOINTS } from "../constants/TranslationConstants"

export async function fetchAutoCandidates(params: AutoCandidatesApiRequest): Promise<AutoCandidatesApiResponse> {
  return post<AutoCandidatesApiResponse, AutoCandidatesApiRequest>(
    TRANSLATION_API_ENDPOINTS.AUTO_CANDIDATES,
    params
  )
}
```

**`src/2_background/handlers/AutoCandidatesRequestHandler.ts`** — New handler:
```typescript
export async function handleAutoCandidatesRequest(
  message: AutoCandidatesRequestMessage,
  sendResponse: (response: AutoCandidatesResponseMessage) => void
): Promise<void> {
  try {
    await serviceInitializer.ensureCriticalServicesReady()
    const result = await autoCandidatesService.fetchAutoCandidates(message.data)
    sendResponse({ type: "AUTO_CANDIDATES_RESPONSE", success: true, data: result })
  } catch (error) {
    // Silent degradation
    sendResponse({
      type: "AUTO_CANDIDATES_RESPONSE",
      success: true,
      data: { traceId: "", candidates: [], meta: { degraded: true, ... } }
    })
  }
}
```

**`src/2_background/messaging/MessageRouter.ts`** — Add case:
```typescript
case "AUTO_CANDIDATES_REQUEST":
  AutoCandidatesRequestHandler.handleAutoCandidatesRequest(message, sendResponse)
  return true
```

### 8.2 UserSettings Extension

In `src/0_common/types/index.ts`, extend `UserSettings`:
```typescript
export interface UserSettings {
  // ... existing fields ...
  /** Enable automatic supplementary translation after manual translation */
  enableAutoTranslate: boolean
  /** User language proficiency level for auto-translation */
  userLanguageProficiency: "Beginner" | "Intermediate" | "Advanced"
}
```

With defaults:
```typescript
export const DEFAULT_USER_SETTINGS: UserSettings = {
  // ... existing ...
  enableAutoTranslate: false,
  userLanguageProficiency: "Intermediate",
}
```

### 8.3 Integration Sequence Diagram

```
Content Script                 Background Worker              Cloud API
     │                              │                            │
     │ ── manual translate ────────>│                            │
     │                              │ ── POST /api/v1/translate─>│
     │                              │ <── TranslationResult ─────│
     │ <── TRANSLATE_RESPONSE ──────│                            │
     │                              │                            │
     │ (manual success callback)    │                            │
     │ (check: enabled? block       │                            │
     │  not already scanned?)       │                            │
     │                              │                            │
     │ ── AUTO_CANDIDATES_REQUEST ─>│                            │
     │                              │ ── POST auto-candidates ──>│
     │                              │ <── candidates[] ──────────│
     │ <── AUTO_CANDIDATES_RESPONSE─│                            │
     │                              │                            │
     │ (filter, map to DOM,         │                            │
     │  render sequentially)        │                            │
```

---

## 9. Backend Implementation Architecture

### 9.1 Server-Side Processing Flow

```
Incoming Request
    │
    ▼
Validate request schema
    │  ✗ → 400 Bad Request
    ▼
Authenticate JWT token
    │  ✗ → 401 Unauthorized
    ▼
Rate limit check
    │  ✗ → 429 Too Many Requests
    ▼
Pre-validate blockText
    │  too short → return empty candidates
    │  too long → truncate
    ▼
Build LLM prompt
    │  system prompt + user prompt (rendered from template)
    ▼
Call LLM
    │  timeout → degrade to empty
    ▼
Parse LLM JSON output
    │  parse failure → degrade to empty
    ▼
Hard-rule filtering pipeline
    │  (see Section 5)
    ▼
Build response
    │
    ▼
Return AutoCandidatesApiResponse
```

### 9.2 Backend Module Structure (Suggested)

```
server/
  routes/
    translateRoutes.ts          ← add POST /api/v1/translate/auto-candidates
  controllers/
    autoCandidatesController.ts ← request validation, orchestration
  services/
    autoCandidatesService.ts    ← LLM call + pipeline orchestration
    candidateFilter.ts          ← hard-rule filtering pipeline
    candidateNormalizer.ts      ← offset computation, occurrence expansion, dedup, ranking, reason stripping
  prompts/
    auto_candidates/
      system_prompt.txt
      user_prompt_template.txt
  types/
    autoCandidatesTypes.ts      ← request/response type definitions
  constants/
    autoCandidatesConstants.ts  ← MAX_AUTO_CANDIDATES, MIN_BLOCK_LENGTH, etc.
```

### 9.3 Key Constants

```typescript
const MAX_AUTO_CANDIDATES = 5         // Capped upper bound
const MIN_BLOCK_LENGTH = 20           // Skip blocks shorter than this
const MAX_BLOCK_LENGTH = 5000         // Truncate blocks longer than this
const LLM_TIMEOUT_MS = 15000          // LLM call timeout
const LLM_TEMPERATURE = 0.3           // Low temperature for consistency
const LLM_MAX_TOKENS = 2000           // Enough for candidate list + translations
```

---

## 10. Cost, Performance, and Protection

### 10.1 Cost Analysis

| Factor | Impact |
|--------|--------|
| LLM invocation | ~1 call per block per manual trigger (dominant cost) |
| Token consumption | Input: ~blockText length + prompt overhead; Output: ~candidate list |
| Frequency | At most 1 auto-request per unique block |
| Mitigation | Conservative budget cap (3-5 candidates), short block text |

### 10.2 Latency Budget

| Stage | Expected Time |
|-------|---------------|
| Request validation | <5ms |
| LLM round-trip | 1-5 seconds (dominant) |
| Hard-rule pipeline | <10ms |
| Total | 1-5 seconds |

Frontend should show auto-translations whenever they arrive; the user continues reading in the meantime.

### 10.3 Rate Limiting

- Per-user rate limit: suggested 10 auto-candidate requests per minute
- Global concurrency guard: suggested max 50 concurrent LLM calls for auto-candidates
- Auto-candidates traffic must not starve the manual translation endpoint

### 10.4 Caching (V1.1)

V1 ships without semantic caching. Future optimization opportunity:
- Cache key: `hash(blockText + userLevel + sourceLang + targetLang)`
- TTL: 5 minutes (short, since context changes affect results)
- Invalidation: not needed (TTL-based expiry)

---

## 11. `userLevel` Behavior Specification

The `userLevel` parameter directly influences which candidates the LLM selects.

| Level | Selection Criteria | Expected Density |
|-------|-------------------|------------------|
| Beginner | Include relatively common vocabulary that non-native readers may not know; cast a wider net | Higher (closer to limit) |
| Intermediate | Focus on mid-frequency vocabulary and phrases with non-obvious combined meanings | Moderate |
| Advanced | Only select genuinely difficult, rare, or domain-specific terms; the reader knows most words | Lower (often under limit) |

The LLM prompt encodes this directly:
> "A {userLevel} reader should find these genuinely helpful"

Backend does NOT implement rule-based word frequency filtering in V1. The LLM uses `userLevel` as a contextual signal in the prompt. Future versions may add dictionary-based frequency validation.

---

## 12. Test Recommendations

### 12.1 Backend Unit Tests

| Test Area | Cases |
|-----------|-------|
| Request validation | Missing required fields, invalid userLevel, empty blockText |
| Offset computation | Backend correctly computes offsets via `indexOf`; text not found → drop |
| Occurrence expansion | Single LLM candidate with text appearing 3 times → 3 response entries |
| Reason stripping | `reason` field present in LLM output, absent from API response |
| Duplicate removal | Same text at different positions, case-insensitive dedup |
| Phrase-over-word | Phrase [10,25) contains word [15,20) → word dropped |
| Excluded text filtering | Exact match, case-insensitive match |
| Noise filtering | Punctuation, numbers, URLs, single chars |
| Capped bound | limit=10 but MAX=5 → returns 5 |
| Degradation | LLM timeout → empty candidates; parse failure → empty candidates |
| Empty block | blockText.length < 20 → empty candidates, no LLM call |

### 12.2 Backend Integration Tests

| Test Area | Cases |
|-----------|-------|
| Happy path | Valid request → stable response schema with candidates |
| Auth failure | No token → 401 |
| Rate limit | Exceed per-user limit → 429 |
| LLM failure | Mock timeout → degraded empty response |
| Mixed candidates | Word+phrase overlap → phrase survives |
| `excludedTexts` | Excluded items never appear in response |

---

## 13. Implementation Recommendations

### 13.1 Development Order

1. **Define types and validation schema** — request/response TypeScript types, JSON Schema for backend validation
2. **Implement hard-rule filtering pipeline** — testable independently of LLM; write unit tests first
3. **Implement LLM prompt + parsing** — system prompt, user prompt template, JSON response parser
4. **Wire pipeline end-to-end** — LLM output → pipeline → response
5. **Add degradation handling** — timeout, parse failure, empty results
6. **Add rate limiting** — per-user and global concurrency
7. **Frontend integration** — message types, background handler, service function
8. **Joint contract verification** — frontend sends real request, backend returns real response

### 13.2 Quality Principles

- **Over-filter, under-select**: better to return 1 great candidate than 5 mediocre ones
- **Never pass raw LLM output**: every candidate must survive the filtering pipeline
- **Offset accuracy is non-negotiable**: offsets are computed deterministically by the backend, not by the LLM — a candidate with wrong offsets is worse than no candidate
- **Silent failure**: the user should never see an error from auto-translation

### 13.3 Local LLM Variant (Custom API Path)

When `translationProvider === "customApi"`, the auto-candidates flow should support local LLM execution, following the same pattern as `translateWord()`:
1. Build `LLMConfig` from `userSettings.customApi`
2. Assemble system + user prompt
3. Call `OpenAICompatibleClient.generate(messages)`
4. Parse JSON response
5. Run through the same hard-rule filtering pipeline
6. Return result

This ensures the feature works for both cloud and custom API users, consistent with the existing multi-provider architecture.

---

## 14. Appendix: Existing API Endpoint Reference

For context, the existing translation endpoints that the new endpoint sits alongside:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v1/translate` | POST | Single word context-aware translation |
| `/api/v1/translate/fragment` | POST | Fragment/phrase context-aware translation |
| `/api/v1/translate/auto-candidates` | POST | **NEW** Auto-translation candidate identification |
| `/api/v1/config` | GET | Public configuration (quota, version) |
| `/api/v1/auth/extension/token` | POST | JWT token issuance |

---

## 15. Appendix: Full Example — Beginner vs Advanced

### Block Text
> "The implications of quantum entanglement for cryptography are profound, challenging our fundamental assumptions about the nature of secure communication."

### Beginner Level Response
```json
{
  "candidates": [
    { "text": "implications", "type": "word", "start": 4, "end": 16, "translation": "影响", "source": "llm" },
    { "text": "quantum entanglement", "type": "phrase", "start": 20, "end": 40, "translation": "量子纠缠", "source": "llm" },
    { "text": "profound", "type": "word", "start": 60, "end": 68, "translation": "深远的", "source": "llm" },
    { "text": "fundamental assumptions", "type": "phrase", "start": 86, "end": 108, "translation": "基本假设", "source": "llm" }
  ]
}
```

> **Note:** These are API response examples (after backend processing). The LLM internal output uses `reason→text→type→translation` field order, but `reason` is stripped and offsets are computed by the backend before the response is sent.

### Advanced Level Response
```json
{
  "candidates": [
    { "text": "quantum entanglement", "type": "phrase", "start": 20, "end": 40, "translation": "量子纠缠", "source": "llm" }
  ]
}
```

This demonstrates how `userLevel` affects translation result density while maintaining the same quality bar.
