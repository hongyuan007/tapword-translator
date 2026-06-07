# Full-Text Batch Translation Pipeline — Architecture Research Report

**Date**: 2026-03-17  
**Status**: READ-ONLY Research  
**Scope**: End-to-end analysis of the current full-text translation pipeline + reference project comparison

---

## 1. Current Architecture: End-to-End Flow

### 1.1 Overall Pipeline

```
Content Script (BatchQueue)
    │  chrome.runtime.sendMessage('FULL_TRANSLATE_BATCH_REQUEST')
    ▼
Background (FullTranslateBatchHandler)
    │  sequential loop: translateModule.translateFragment() × N
    ▼
6_translate/TranslationService.translateFragment()
    │  post(TRANSLATE_FRAGMENT, request)  ← via 5_backend/APIService
    ▼
Backend: POST /api/v1/translate/fragment
    │  translation.controller.translateFragmentHandler()
    ▼
translation.service.translateFragment()
    │  FragmentTranslationService.translateFragment()
    ▼
7_generate/FragmentTranslation.service.ts
    │  buildMessages() → GenerationLLMService.generateWithUsage()
    ▼
LLM Provider (Qwen/Atlas Cloud via OpenAI SDK)
```

### 1.2 Content Script: BatchQueue (`src/11_full_translate/utils/BatchQueue.ts`)

- **Batching logic**: Accumulates text segments from DOM walker, groups them by character count (`DEFAULT_MAX_CHARS_PER_BATCH`) and item count (`DEFAULT_MAX_ITEMS_PER_BATCH`).
- **Flush trigger**: Timer-based (`DEFAULT_BATCH_DELAY_MS`) or when batch is full.
- **Communication**: Each batch sends a `FULL_TRANSLATE_BATCH_REQUEST` Chrome message containing `{ texts: string[], sourceLang, targetLang }`.
- **Retry**: On `BatchCountMismatchError`, retries up to 3 times with exponential backoff (1s, 2s, 4s, max 8s).
- **Fallback**: After retries exhausted, falls back to individual translation (sends each text in its own single-item batch message).
- **Promise management**: Each `enqueue()` returns a `Promise<string>` that resolves when the background handler responds.

### 1.3 Background: FullTranslateBatchHandler (`src/2_background/handlers/FullTranslateBatchHandler.ts`)

- **Current approach is naive**: Iterates over `data.texts[]` with a **sequential for-loop**, calling `translateModule.translateFragment()` for each text individually.
- **No batching at API level**: Each text results in a separate HTTP request to `POST /api/v1/translate/fragment`.
- **Error handling**: On individual failure, pushes empty string `""` and continues. Total success/failure count is logged.
- **Comment in code**: `"Will be replaced with a dedicated batch API endpoint later"`.

### 1.4 Extension TranslationService (`src/6_translate/services/TranslationService.ts`)

- `translateFragment()` supports multiple providers: official cloud, customApi, mtranserver, bingTranslate.
- For official cloud: builds `FragmentTranslationApiRequest` with `text, leadingText, trailingText, sourceLanguage, targetLanguage, context`.
- Uses `post<>()` from `5_backend/APIService` which handles JWT tokens, error parsing, rate limiting automatically.
- **No batch/bulk method exists** in the translation service layer.

### 1.5 Extension API Client (`src/5_backend/`)

- `APIService` class: Centralized HTTP client with `get()`, `post()`, `put()`, `del()` convenience functions.
- Features: Generic type-safe request/response, JWT token management, auto token refresh, timeout handling, rate limit detection.
- `initAPIService()` configures base URL and token callbacks at startup.
- Error types: `APIError` discriminated union (businessError, networkError, tokenExpired, rateLimited).
- Response structure: `APIResponse<T>` with `data`, `code`, `message` fields.

### 1.6 Backend: Route & Controller

- **Route**: `POST /api/v1/translate/batch` → `translateBatchHandler` (already exists!)
- **Middleware stack**: `jwtMiddleware.verifyJwt` → `versionCheckMiddleware` → `batchTranslateRateLimiter` (10 req/30s)
- **Controller validation**: max 10 texts, max 5000 total chars, non-empty strings, requires sourceLanguage + targetLanguage.
- **Service**: `translation.service.translateBatch()` — uses `Promise.allSettled()` to translate all texts concurrently via `translateFragment()`.

### 1.7 Backend: translateBatch (`translation.service.ts`)

- Calls `translateFragment()` for each text in parallel (via `Promise.allSettled`).
- Each `translateFragment()` call triggers a full fragment translation pipeline: language detection → LLM prompt building → LLM API call.
- Failed individual translations return empty string `""`.
- Aggregates token usage across all results.
- **Key issue**: N texts = N separate LLM calls. No prompt-level batching.

### 1.8 Backend: FragmentTranslation.service.ts

- Uses `GenerationLLMService` (OpenAI SDK wrapper) with `response_format: { type: "json_object" }`.
- Two prompt modes:
  - **fragment_translation**: Includes both fragment translation + sentence translation (when leading/trailing text provides context).
  - **fragment_translation_only**: Fragment-only translation (when fragment IS the full sentence).
- Decision function `shouldIncludeSentenceTranslation()` checks if fragment equals the full sentence.
- Builds messages: `[system, ...fewshot, user]` with optional context caching.
- Parses JSON response, extracts `translation` and optionally `sentence_translation`.

### 1.9 LLM Service (`generationLLM.service.ts`)

- Wraps OpenAI SDK with configurable model, temperature (default 0.35), max_tokens (default 1200).
- Timeout: 10 seconds.
- Forces `response_format: { type: "json_object" }` and `enable_thinking: false`.
- Error mapping: RateLimitError → BizError, BadRequestError → BizError, TimeoutError → BizError.
- Token usage tracking via `TokenTracker` singleton.

---

## 2. Current Prompts Analysis

### 2.1 Fragment Translation System Prompt

```
You are a professional multilingual fragment translation expert.

Core Task: Translate the fragment within <fragment> tags, plus the complete sentence in <sentence> tags.
Output: {"translation":"...", "sentence_translation":"..."}
```

- **Designed for**: A single short text fragment (phrase, clause) within a sentence.
- **Strong features**: Context-aware (uses surrounding sentence + paragraph), handles leading/trailing text, source metadata (title, author).
- **Limitations for full-text**:
  - Expects single fragment + sentence structure — not multiple paragraphs.
  - `sentence_translation` field is irrelevant for full-text (the text IS the sentence).
  - Overhead: Each call includes system prompt + fewshot examples + user prompt (~500-800 tokens of prompt overhead per text).
  - No batch awareness — cannot translate multiple texts in one LLM call.

### 2.2 Fragment-Only System Prompt

```
Core Task: Translate ONLY the Target Fragment.
Output: {"translation":"..."}
```

- Simpler version, used when fragment = full sentence.
- Same overhead issue: full system prompt + fewshot per individual text.

### 2.3 Text Translation Prompts (existing but unused for full-text)

```
Core Task: Translate text (one or more sentences) from source to target language.
Output: {"translation": "..."}
Context: sourceTitle, sourceAuthor for tone preservation.
```

- **Already exists** in `resources/generate/text_translation/` directory.
- Simpler, paragraph-oriented prompt — closer to what full-text translation needs.
- Used by `textTranslation.service.ts` via `POST /api/v1/translate/sentence`.
- Currently NOT used by the full-text pipeline.

---

## 3. Read-Frog Reference Analysis

### 3.1 Architecture Overview

Read-frog uses a more sophisticated batching architecture:

```
Content Script
    │  sendMessage("enqueueTranslateRequest", { text, langConfig, providerConfig, hash })
    ▼
Background (translation-queues.ts)
    │  BatchQueue<TranslateBatchData, string> + RequestQueue
    ▼
executeTranslate(batchText, ..., { isBatch: true })
    │  Dispatches to provider: aiTranslate / googleTranslate / microsoftTranslate
    ▼
LLM / API Provider
```

### 3.2 Key Design Decisions

1. **Text-level batching with separator**: Multiple texts are joined with `%%` separator before sending to LLM. The LLM response is split back by `%%`. This is a **single LLM call for N texts**.

2. **Generic BatchQueue**: Parameterized `BatchQueue<T, R>` with:
   - `getBatchKey(data)`: Groups by source-target language + provider config.
   - `getCharacters(data)`: Character count for batch size limits.
   - `executeBatch(dataList)`: Joins texts with separator, makes one API call, splits result.
   - `executeIndividual(data)`: Fallback for single items on batch failure.
   - Configurable: `maxCharactersPerBatch`, `maxItemsPerBatch`, `batchDelay`, `maxRetries`.

3. **RequestQueue rate limiting**: Separate rate-limited queue wraps the actual API calls with configurable rate/capacity.

4. **Translation caching**: Uses IndexedDB (Dexie) with SHA-256 hash keys for deduplication.

5. **Prompt-level batch support**: System prompt includes batch-specific rules:
   ```
   ## Multi-paragraph Translation Rules
   1. If input contains %%, use %% in output
   2. CRITICAL: Preserve exact formatting around %%
   ```

6. **Article context awareness**: Can generate and cache article summaries for better translation context.

### 3.3 What Read-Frog Does Differently

| Aspect | TapWord (Current) | Read-Frog |
|--------|-------------------|-----------|
| Batch granularity | N texts → N LLM calls | N texts → 1 LLM call (separator-based) |
| Batching location | Content script batches, background unbatches | Background handles all batching |
| Rate limiting | Backend-side only | Client-side RequestQueue + backend |
| Caching | None | IndexedDB per-text hash cache |
| Provider support | Multiple (cloud, custom, mtranserver, bing) | Multiple (LLM, Google, Microsoft, DeepLX) |
| Prompt strategy | Fragment-specific prompt per text | Single batch-aware translation prompt |
| Context | Per-fragment sentence context | Article title + summary |

---

## 4. Backend API Infrastructure (src/5_backend)

### 4.1 APIService Architecture

- **Singleton pattern**: Single `APIService` instance configured at startup via `initAPIService({ baseURL, getToken, refreshToken })`.
- **Generic methods**: `post<TResponse, TRequest>(endpoint, body)` returns `Promise<TResponse>`.
- **Error handling**: Parses backend `APIResponse<T>` envelope, throws typed `APIError` on failure.
- **Token management**: Auto-attaches JWT, handles refresh on 401.
- **Rate limiting**: Detects 429 status, throws `APIError` with `type: 'rateLimited'`.

### 4.2 Adding New Endpoints

To add a new batch endpoint, the pattern would be:
1. Add endpoint constant in `TranslationConstants.ts`.
2. Define request/response types in `TranslationApiTypes.ts`.
3. Call `post<Response, Request>(endpoint, body)` in TranslationService.
4. All auth, error handling, token refresh handled automatically.

---

## 5. Key Differences: Full-Text vs Fragment Translation

| Requirement | Fragment Translation | Full-Text Translation |
|-------------|---------------------|-----------------------|
| **Text length** | Short (1-50 words) | Variable (1 sentence to 1 paragraph) |
| **Context** | Rich (leading, trailing, prev/next sentences, source metadata) | Minimal (just source/target language) |
| **Sentence translation** | Often needed (fragment within sentence) | Never needed (text IS the content) |
| **Volume** | 1-5 per user action | 50-500+ per page |
| **Latency tolerance** | Low (user waiting) | Medium (progressive rendering) |
| **Cost sensitivity** | Low (few calls) | High (many calls, many tokens) |
| **Language detection** | Per-text with context correction | Per-page (already known) |
| **Prompt overhead** | Acceptable (1 call) | Unacceptable (N calls × overhead) |
| **LLM model needs** | Quality-focused | Speed+cost balanced |
| **Error recovery** | Show error per word | Skip failed, show rest |

### 5.1 Current Pain Points

1. **N×1 LLM calls**: Each text in a batch triggers a separate LLM call with full prompt overhead. For a page with 200 paragraphs → 200 LLM API calls.
2. **Wasted prompt tokens**: System prompt (~200 tokens) + fewshot examples (~400 tokens) repeated per text.
3. **Unnecessary features**: Language detection, sentence translation, dictionary lookup — all irrelevant for full-text.
4. **Sequential processing in background handler**: The for-loop processes texts one-by-one (not even parallel).
5. **No endpoint-level batching**: The existing `/batch` endpoint just calls `translateFragment` N times in parallel — no LLM-level batching.
6. **No caching**: Same paragraph translated twice wastes tokens.

---

## 6. Recommended Architecture

### 6.1 High-Level Design

```
Content Script (BatchQueue)  ── unchanged batching logic
    │  chrome.runtime.sendMessage('FULL_TRANSLATE_BATCH_REQUEST')
    ▼
Background (FullTranslateBatchHandler)  ── NEW: calls batch endpoint
    │  post('/api/v1/translate/full-text-batch', { texts, sourceLang, targetLang })
    ▼
Backend: POST /api/v1/translate/full-text-batch  ── NEW dedicated endpoint
    │  fullTextBatch.controller → fullTextBatch.service
    ▼
FullTextBatchTranslation.service  ── NEW LLM service
    │  Single LLM call with separator-based batching
    │  Dedicated system prompt optimized for paragraph translation
    │  Potentially different/cheaper model
    ▼
LLM Provider
```

### 6.2 New Backend Endpoint

```
POST /api/v1/translate/full-text-batch

Request:
{
  "texts": ["paragraph 1", "paragraph 2", ...],
  "sourceLanguage": "en",
  "targetLanguage": "zh"
}

Response:
{
  "code": 0,
  "data": {
    "translations": ["翻译1", "翻译2", ...],
    "sourceLanguage": "en",
    "targetLanguage": "zh",
    "usage": { "promptTokens": N, "completionTokens": N, "totalTokens": N }
  }
}
```

### 6.3 New LLM Service: FullTextBatchTranslation

Key design choices:

1. **Separator-based batching** (inspired by read-frog): Join N texts with `%%` separator in a single LLM call. Parse response by splitting on `%%`.

2. **Dedicated system prompt** optimized for paragraph translation:
   ```
   You are a professional translator. Translate each paragraph from {source} to {target}.
   
   Rules:
   - Each paragraph is separated by %%
   - Translate each paragraph independently
   - Output translations in the same order, separated by %%
   - Preserve paragraph count exactly
   - Do not add explanations
   ```

3. **Model configuration**: Separate env vars for full-text model (potentially cheaper/faster model like `qwen-turbo` vs `qwen-plus`).

4. **No JSON response format**: Plain text with separator is simpler and cheaper (no JSON overhead, no parsing failures).

5. **Higher max_tokens**: Full-text batches produce more output (e.g., `max_tokens: 4000` instead of `1200`).

6. **No language detection**: Source language is already known at the page level.

7. **No sentence translation**: Not applicable — each text IS the content to translate.

### 6.4 Extension Changes

1. **Background handler**: Replace sequential `translateFragment()` loop with single `post('/api/v1/translate/full-text-batch', ...)` call.

2. **TranslationService**: Add new `translateFullTextBatch(params)` method.

3. **TranslationConstants**: Add `TRANSLATE_FULL_TEXT_BATCH: "/api/v1/translate/full-text-batch"`.

4. **Provider routing**: Full-text batch should support official cloud, customApi, and potentially fall back to per-text for mtranserver/bing.

### 6.5 Cost/Performance Gains

| Metric | Current (N=10 texts) | Proposed (N=10 texts) |
|--------|---------------------|----------------------|
| LLM calls | 10 | 1 |
| System prompt tokens | ~200 × 10 = 2000 | ~200 × 1 = 200 |
| Fewshot tokens | ~400 × 10 = 4000 | 0 (not needed) |
| Network round trips | 10 HTTP requests | 1 HTTP request |
| Estimated latency | 10 × 1-3s = 10-30s serial | 1 × 2-5s = 2-5s |

### 6.6 Risk Considerations

1. **Count mismatch**: LLM may not return exactly N paragraphs. Mitigation: retry logic (already exists in BatchQueue) + robust separator parsing.
2. **Token limit overflow**: Large batches may exceed model's max context. Mitigation: Character-based batch splitting in content script (already exists).
3. **Mixed quality**: Batching may reduce per-paragraph quality vs individual translation. Mitigation: Testing + model selection.
4. **Separator collision**: `%%` may appear in source text. Mitigation: Use a more unique separator (e.g., `⟦SEP⟧` or `\n---SPLIT---\n`).

---

## 7. Summary of Key Architectural Findings

1. **The full-text translation pipeline currently reuses fragment translation infrastructure**, resulting in N individual LLM calls per batch — each with full prompt overhead, language detection, and optional sentence translation that isn't needed.

2. **A dedicated batch endpoint already exists** (`POST /api/v1/translate/batch`) but it simply calls `translateFragment()` N times in parallel — no LLM-level batching.

3. **A `text_translation` prompt already exists** in the backend resources that is closer to what full-text needs (paragraph-level, simpler prompt, no sentence_translation).

4. **Read-frog demonstrates a proven pattern**: Separator-based text joining (`%%`) for single-LLM-call batching, with fallback to individual on count mismatch.

5. **The extension's API infrastructure (`5_backend/APIService`)** already handles all cross-cutting concerns (auth, errors, rate limiting), making the addition of a new endpoint straightforward.

6. **Estimated improvement**: ~10x reduction in LLM calls and ~80% reduction in prompt token waste for typical pages.
