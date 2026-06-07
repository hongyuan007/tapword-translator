# Full-Text Batch Translation API — Technical Specification

**Date**: 2026-03-17  
**Status**: Implementation-Ready Spec  
**Based on**: `260317_batch_api_research.md`  
**Scope**: New dedicated backend endpoint + extension integration for LLM-level batched full-text translation

---

## Table of Contents

1. [Overview](#1-overview)
2. [Backend: New Endpoint](#2-backend-new-endpoint)
3. [Backend: New LLM Service](#3-backend-new-llm-service)
4. [Backend: New Prompt Template](#4-backend-new-prompt-template)
5. [Backend: Route, Controller, Service Integration](#5-backend-route-controller-service-integration)
6. [Extension: Handler Changes](#6-extension-handler-changes)
7. [Extension: New API Types & Constants](#7-extension-new-api-types--constants)
8. [Error Handling & Fallback Strategy](#8-error-handling--fallback-strategy)
9. [File Change Summary](#9-file-change-summary)
10. [API Examples](#10-api-examples)

---

## 1. Overview

### Problem

The current full-text translation pipeline issues **N separate LLM calls** for a batch of N texts. Each call carries ~600 tokens of prompt overhead (system prompt + fewshot examples). For a typical page with 200 paragraphs split into 20 batches of 10, this means 200 individual LLM API calls.

### Solution

A new dedicated endpoint `POST /api/v1/translate/full-text-batch` that:
- Joins all input texts with a `%%` separator into a **single LLM prompt**
- Makes **one LLM call** per batch
- Parses the response by splitting on `%%`
- Uses a dedicated, minimal system prompt optimized for paragraph-level translation (no fewshot, no JSON, no sentence_translation)

### Expected Gains

| Metric | Current (N=10 texts) | Proposed (N=10 texts) |
|--------|---------------------|----------------------|
| LLM calls | 10 | 1 |
| System prompt tokens | ~200 × 10 = 2000 | ~200 × 1 = 200 |
| Fewshot tokens | ~400 × 10 = 4000 | 0 |
| Network round trips (ext→backend) | 10 HTTP | 1 HTTP |
| Estimated latency | 10-30s serial | 2-5s |

---

## 2. Backend: New Endpoint

### Endpoint

```
POST /api/v1/translate/full-text-batch
```

### Request Format

```typescript
// File: src/1_translate/types/translation.d.ts (backend)
interface FullTextBatchTranslationRequest {
    texts: string[]          // Array of paragraph/sentence texts (max 10)
    sourceLanguage: string   // e.g. "en"
    targetLanguage: string   // e.g. "zh"
}
```

### Response Format

```typescript
// File: src/1_translate/types/translation.d.ts (backend)
interface FullTextBatchTranslationResponse {
    translations: string[]   // Same length and order as texts[]
    sourceLanguage: string
    targetLanguage: string
    usage?: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
    }
}
```

### Validation Rules (Controller)

| Rule | Constraint |
|------|-----------|
| `texts` must be non-empty array | `Array.isArray(texts) && texts.length > 0` |
| Max items | `texts.length <= 10` |
| Each text non-empty | `typeof t === 'string' && t.trim().length > 0` |
| Total character limit | `sum(texts.map(t => t.length)) <= 5000` |
| Required fields | `sourceLanguage` and `targetLanguage` must be present |

### Middleware Stack

```
jwtMiddleware.verifyJwt → versionCheckMiddleware → fullTextBatchRateLimiter → translateFullTextBatchHandler
```

Rate limiter config: **10 requests / 30 seconds** per UID (matches existing batch endpoint).

---

## 3. Backend: New LLM Service

### File: `src/7_generate/services/FullTextBatchTranslation.service.ts`

```typescript
import { GenerationLLMService, ChatMessage } from "@/7_generate/services/llm/generationLLM.service"
import * as promptLoader from "@/7_generate/utils/promptLoader"
import { renderTemplate } from "@/7_generate/utils/templateRenderer"
import { BusinessError } from "@/0_common/error/BusinessError"
import * as errorCodes from "@/0_common/error/errorCodes"
import * as loggerModule from "@/0_common/utils/logger"
import * as languageMapper from "@/1_translate/utils/languageMapper"
import { TokenUsage, GenerationResult } from "@/7_generate/types/generate"

const logger = loggerModule.createLogger("generate.fullTextBatchTranslation")
const TASK_NAME = "full_text_batch"
const SEPARATOR = "%%"
const MAX_TOKENS_FULL_TEXT_BATCH = 4000

// --- Types ---

export interface FullTextBatchRequest {
    texts: string[]
    sourceLanguage: string
    targetLanguage: string
}

export interface FullTextBatchResult {
    translations: string[]
    usage: TokenUsage | null
}

export interface FullTextBatchModelConfig {
    apiKey: string
    baseUrl: string
    model: string
    providerName: string
}

// --- Service ---

export class FullTextBatchTranslationService {
    private generationClient: GenerationLLMService
    private systemPrompt: string
    private userPromptTemplate: string

    constructor(config: FullTextBatchModelConfig) {
        this.generationClient = new GenerationLLMService(
            config.apiKey,
            config.baseUrl,
            config.model
        )
        this.systemPrompt = promptLoader.loadSystemPrompt(TASK_NAME)
        this.userPromptTemplate = promptLoader.loadUserPromptTemplate(TASK_NAME)
    }

    /**
     * Translate a batch of texts with a single LLM call using separator-based joining.
     *
     * Strategy:
     * 1. Join all texts with "%%" separator
     * 2. Send as single LLM call with plain-text response (no JSON)
     * 3. Split response on "%%" to recover individual translations
     * 4. Validate segment count matches input count
     *
     * @throws BusinessError if LLM returns mismatched segment count after retry
     */
    async translateBatch(request: FullTextBatchRequest): Promise<FullTextBatchResult> {
        const { texts, sourceLanguage, targetLanguage } = request

        // Build the combined input with separator
        const combinedInput = texts.join(` ${SEPARATOR} `)

        const { sourceName, targetName } = languageMapper.getLanguageNames(sourceLanguage, targetLanguage)

        const userPrompt = renderTemplate(this.userPromptTemplate, {
            sourceLanguage: sourceName,
            targetLanguage: targetName,
            text: combinedInput,
            count: String(texts.length),
        })

        const messages: ChatMessage[] = [
            { role: "system", content: this.systemPrompt },
            { role: "user", content: userPrompt },
        ]

        // First attempt
        let result = await this.callAndParse(messages, texts.length)

        if (result.translations.length === texts.length) {
            return result
        }

        // Retry once on count mismatch
        logger.warn(
            `Segment count mismatch: expected ${texts.length}, got ${result.translations.length}. Retrying...`
        )
        result = await this.callAndParse(messages, texts.length)

        if (result.translations.length !== texts.length) {
            logger.error(
                `Segment count mismatch after retry: expected ${texts.length}, got ${result.translations.length}`
            )
            const { code, message } = errorCodes.BizErrorCode.UPSTREAM_PROVIDER_ERROR
            throw new BusinessError(
                code,
                `${message} (Batch segment count mismatch: expected ${texts.length}, got ${result.translations.length})`
            )
        }

        return result
    }

    private async callAndParse(messages: ChatMessage[], expectedCount: number): Promise<FullTextBatchResult> {
        // Use generateWithUsage for token tracking, but override to NOT use JSON response format.
        // The GenerationLLMService currently forces response_format: { type: "json_object" }.
        // For this service, we need plain text. See "Implementation Note" below.
        const genResult: GenerationResult = await this.generationClient.generateWithUsage(messages, {
            maxTokens: MAX_TOKENS_FULL_TEXT_BATCH,
        })

        const translations = this.parseResponse(genResult.content)

        return {
            translations,
            usage: genResult.usage,
        }
    }

    /**
     * Parse the LLM response by splitting on the "%%" separator.
     * Trims each segment and filters out empty artifacts.
     */
    private parseResponse(content: string): string[] {
        return content
            .split(SEPARATOR)
            .map(segment => segment.trim())
            .filter(segment => segment.length > 0)
    }
}

// --- Factory ---

export function createFullTextBatchTranslationService(
    config: FullTextBatchModelConfig
): FullTextBatchTranslationService {
    return new FullTextBatchTranslationService(config)
}
```

### Implementation Note: Plain Text vs JSON Response

The existing `GenerationLLMService` forces `response_format: { type: "json_object" }`. For full-text batch translation, **plain text with separator is simpler and cheaper** — no JSON parsing overhead, no risk of malformed JSON.

**Two approaches** (implementer chooses):

1. **Wrap in JSON** (minimal change): Keep JSON mode, but use a simpler schema:
   ```
   {"translations": "translation1 %% translation2 %% translation3"}
   ```
   Parse with: `JSON.parse(content).translations.split("%%").map(s => s.trim())`

2. **Add plain-text mode to GenerationLLMService** (better long-term): Add an optional parameter to `generateWithUsage()` to skip `response_format: { type: "json_object" }`. This is the recommended approach as it avoids JSON overhead.

   ```typescript
   // In GenerationLLMService.generateWithUsage():
   export interface GenerationOptions {
       temperature?: number
       maxTokens?: number
       responseFormat?: "json" | "text"  // NEW: default "json" for backward compat
   }
   ```

   If `responseFormat === "text"`, omit `response_format` from the OpenAI request.

**Recommendation**: Start with **Approach 1** (JSON wrapper) for quick implementation. Refactor to **Approach 2** later.

If using Approach 1, the system prompt must instruct the LLM to output JSON:
```
Output format: {"translations": "translated1 %% translated2 %% translated3"}
```

And `parseResponse()` becomes:
```typescript
private parseResponse(content: string): string[] {
    let parsed: any
    try {
        parsed = JSON.parse(content)
    } catch {
        // Fallback: try to extract translations field via regex
        const match = content.match(/"translations"\s*:\s*"([\s\S]*?)"(?=\s*})/)
        if (match?.[1]) {
            return match[1].split(SEPARATOR).map(s => s.trim()).filter(s => s.length > 0)
        }
        const { code, message } = errorCodes.BizErrorCode.UPSTREAM_PROVIDER_ERROR
        throw new BusinessError(code, message + " (Could not parse batch response)")
    }

    const translationsStr = typeof parsed.translations === "string" ? parsed.translations : ""
    if (!translationsStr) {
        const { code, message } = errorCodes.BizErrorCode.UPSTREAM_PROVIDER_ERROR
        throw new BusinessError(code, message + " (Missing 'translations' field)")
    }

    return translationsStr.split(SEPARATOR).map(s => s.trim()).filter(s => s.length > 0)
}
```

---

## 4. Backend: New Prompt Template

### Directory: `resources/generate/full_text_batch/`

Create two files:

#### `resources/generate/full_text_batch/system_prompt.txt`

```
You are a professional translator.

## Task
Translate each text segment from the source language to the target language.

## Rules
- Each text segment is separated by the delimiter %%
- Translate each segment independently while maintaining natural fluency
- Output translations in the EXACT same order, separated by %%
- You MUST output EXACTLY the same number of %% delimiters as in the input
- Preserve formatting (line breaks, spacing) within each segment
- Do not add explanations, notes, or commentary
- If a segment is already in the target language, return it unchanged
- Preserve numbers, proper nouns, and special formatting

## Output Format
Output strictly in the following JSON format:
{"translations": "translated_segment_1 %% translated_segment_2 %% translated_segment_3"}

## Critical Errors to Avoid
- Merging or splitting segments (segment count MUST match input)
- Adding extra %% delimiters or omitting them
- Returning commentary outside the JSON
- Translating into a language other than the specified target language
```

#### `resources/generate/full_text_batch/user_prompt_template.txt`

```
# Source Language
${sourceLanguage}

# Target Language
${targetLanguage}

# Number of Segments
${count}

# Text to Translate
${text}
```

### Why No Fewshot Examples

1. **Paragraph translation is straightforward** — unlike word/fragment translation which needs context disambiguation
2. **Token efficiency** — fewshot examples add ~400 tokens per call; with batch translation, the input itself is already large
3. **The system prompt's separator rules are explicit enough** for modern LLMs to follow
4. **Can be added later** if quality testing reveals benefit — create `resources/generate/full_text_batch/en/fewshot.json` etc.

---

## 5. Backend: Route, Controller, Service Integration

### 5.1 Types — `src/1_translate/types/translation.d.ts`

Add to existing file:

```typescript
export interface FullTextBatchTranslationRequest {
    texts: string[]
    sourceLanguage: string
    targetLanguage: string
}

export interface FullTextBatchTranslationResponse {
    translations: string[]
    sourceLanguage: string
    targetLanguage: string
    usage?: { promptTokens: number; completionTokens: number; totalTokens: number }
}
```

### 5.2 Route — `src/1_translate/routes/index.ts`

Add new route (insert before `export default router`):

```typescript
const fullTextBatchRateLimiter = rateLimiterMiddleware.rateLimiterByUid({
    maxRequests: 10,
    windowSeconds: 30,
    keyPrefix: "full-text-batch-translate",
})

router.post(
    "/full-text-batch",
    jwtMiddleware.verifyJwt,
    versionMiddleware.versionCheckMiddleware,
    fullTextBatchRateLimiter,
    translationController.translateFullTextBatchHandler
)
```

### 5.3 Controller — `src/1_translate/controllers/translation.controller.ts`

Add new import and handler:

```typescript
import {
    // ... existing imports ...
    FullTextBatchTranslationRequest,
} from "@/1_translate/types/translation"

const FULL_TEXT_BATCH_MAX_TEXTS = 10
const FULL_TEXT_BATCH_MAX_TOTAL_CHARS = 5000

export async function translateFullTextBatchHandler(req: Request, res: Response) {
    const batchRequest: FullTextBatchTranslationRequest = req.body

    // Validate texts array exists and is non-empty
    if (!Array.isArray(batchRequest.texts) || batchRequest.texts.length === 0) {
        const { code } = errorCodes.SystemErrorCode.BAD_REQUEST
        return apiResponse.sendError(res, code, "The 'texts' field must be a non-empty array.")
    }

    // Validate max items
    if (batchRequest.texts.length > FULL_TEXT_BATCH_MAX_TEXTS) {
        const { code } = errorCodes.SystemErrorCode.BAD_REQUEST
        return apiResponse.sendError(
            res, code,
            `The 'texts' array must not exceed ${FULL_TEXT_BATCH_MAX_TEXTS} items.`
        )
    }

    // Validate each text is a non-empty string
    const hasEmptyText = batchRequest.texts.some(
        (t) => typeof t !== "string" || t.trim().length === 0
    )
    if (hasEmptyText) {
        const { code } = errorCodes.SystemErrorCode.BAD_REQUEST
        return apiResponse.sendError(
            res, code,
            "Each text in the 'texts' array must be a non-empty string."
        )
    }

    // Validate total character count
    const totalChars = batchRequest.texts.reduce((sum, t) => sum + t.length, 0)
    if (totalChars > FULL_TEXT_BATCH_MAX_TOTAL_CHARS) {
        const { code } = errorCodes.SystemErrorCode.BAD_REQUEST
        return apiResponse.sendError(
            res, code,
            `Total character count must not exceed ${FULL_TEXT_BATCH_MAX_TOTAL_CHARS}. Got ${totalChars}.`
        )
    }

    // Validate required language fields
    if (!batchRequest.sourceLanguage || !batchRequest.targetLanguage) {
        const { code } = errorCodes.SystemErrorCode.BAD_REQUEST
        return apiResponse.sendError(
            res, code,
            "The 'sourceLanguage' and 'targetLanguage' fields are required."
        )
    }

    try {
        const result = await translationService.translateFullTextBatch(batchRequest)
        apiResponse.sendSuccess(res, result)
    } catch (error) {
        if (error instanceof BusinessError) {
            apiResponse.sendError(res, error.code, error.message)
        } else {
            logger.error("An unexpected error occurred in full-text batch translation:", error)
            const { code, message } = errorCodes.BizErrorCode.UNEXPECTED_SYSTEM_ERROR
            apiResponse.sendError(res, code, message)
        }
    }
}
```

### 5.4 Service — `src/1_translate/services/translation.service.ts`

Add new service function. This follows the same model config pattern as existing services:

```typescript
import {
    createFullTextBatchTranslationService,
    FullTextBatchTranslationService,
    FullTextBatchModelConfig,
} from "@/7_generate/services/FullTextBatchTranslation.service"
import {
    FullTextBatchTranslationRequest,
    FullTextBatchTranslationResponse,
} from "@/1_translate/types/translation"

// Module-level cache
let fullTextBatchTranslationService: FullTextBatchTranslationService | undefined

function getFullTextBatchTranslationConfig(): FullTextBatchModelConfig {
    // Full-text batch can use a faster/cheaper model.
    // Use dedicated env vars with fallback to standard translation env vars.
    if (process.env.REGION === "america") {
        const apiKey = process.env.ATLAS_CLOUD_API_KEY
        const baseUrl = process.env.ATLAS_CLOUD_API_URL
        const model = process.env.ATLAS_CLOUD_MODEL_FAST || process.env.ATLAS_CLOUD_MODEL

        if (!apiKey || !baseUrl || !model) {
            throw new BusinessError(
                errorCodes.SystemErrorCode.SERVER_CONFIG_ERROR.code,
                "Missing Atlas Cloud env vars for FullTextBatchTranslationService"
            )
        }
        return { apiKey, baseUrl, model, providerName: "atlascloud" }
    }

    const apiKey = process.env.BIANLIAN_API_KEY
    const baseUrl = process.env.BIANLIAN_API_URL
    // Prefer a faster model for batch full-text (e.g. qwen-turbo)
    // Falls back to standard model if BIANLIAN_API_MODEL_FAST is not set
    const model = process.env.BIANLIAN_API_MODEL_FAST || process.env.BIANLIAN_API_MODEL

    if (!apiKey || !baseUrl || !model) {
        throw new BusinessError(
            errorCodes.SystemErrorCode.SERVER_CONFIG_ERROR.code,
            "Missing Qwen env vars for FullTextBatchTranslationService"
        )
    }
    return { apiKey, baseUrl, model, providerName: "qwen" }
}

function getFullTextBatchTranslationServiceInstance(): FullTextBatchTranslationService {
    if (!fullTextBatchTranslationService) {
        const config = getFullTextBatchTranslationConfig()
        fullTextBatchTranslationService = createFullTextBatchTranslationService(config)
    }
    return fullTextBatchTranslationService
}

/**
 * Translate multiple texts (paragraphs/sentences) in a single LLM call.
 * Uses separator-based batching for token efficiency.
 *
 * Fallback: On segment count mismatch after retry, falls back to individual
 * fragment translations using the existing translateFragment() pipeline.
 */
export async function translateFullTextBatch(
    request: FullTextBatchTranslationRequest
): Promise<FullTextBatchTranslationResponse> {
    const { texts, sourceLanguage, targetLanguage } = request

    const totalChars = texts.reduce((sum, t) => sum + t.length, 0)
    logger.info(
        `[FullTextBatch] Starting: ${texts.length} texts, ${totalChars} chars, ${sourceLanguage} -> ${targetLanguage}`
    )

    const startTime = performance.now()

    try {
        const service = getFullTextBatchTranslationServiceInstance()
        const result = await service.translateBatch({
            texts,
            sourceLanguage,
            targetLanguage,
        })

        const endTime = performance.now()
        logger.info(`[FullTextBatch] Completed in ${Math.round(endTime - startTime)}ms`)

        if (result.usage) {
            logger.info(
                `[FullTextBatch] Token usage: { promptTokens: ${result.usage.promptTokens}, ` +
                `completionTokens: ${result.usage.completionTokens}, totalTokens: ${result.usage.totalTokens} }`
            )
        }

        return {
            translations: result.translations,
            sourceLanguage,
            targetLanguage,
            usage: result.usage ?? undefined,
        }
    } catch (error) {
        // Fallback: if batch translation fails, fall back to individual translations
        logger.warn("[FullTextBatch] Batch failed, falling back to individual translations:", error)
        return await translateBatchFallback(texts, sourceLanguage, targetLanguage)
    }
}

/**
 * Fallback: translate each text individually via existing translateFragment pipeline.
 * Used when the separator-based batch approach fails.
 */
async function translateBatchFallback(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string
): Promise<FullTextBatchTranslationResponse> {
    const startTime = performance.now()
    logger.info(`[FullTextBatch:Fallback] Starting individual translations for ${texts.length} texts`)

    const results = await Promise.allSettled(
        texts.map((text) => {
            const fragmentReq: FragmentTranslationRequest = {
                text,
                sourceLanguage,
                targetLanguage,
            }
            return translateFragment(fragmentReq)
        })
    )

    const translations = results.map((result, index) => {
        if (result.status === "fulfilled") {
            return result.value.translation
        }
        logger.error(`[FullTextBatch:Fallback] Failed at index ${index}:`, result.reason)
        return ""
    })

    // Aggregate token usage
    let totalPromptTokens = 0
    let totalCompletionTokens = 0
    let totalTokens = 0
    let hasUsage = false
    for (const result of results) {
        if (result.status === "fulfilled" && result.value.usage) {
            totalPromptTokens += result.value.usage.promptTokens
            totalCompletionTokens += result.value.usage.completionTokens
            totalTokens += result.value.usage.totalTokens
            hasUsage = true
        }
    }

    const endTime = performance.now()
    logger.info(`[FullTextBatch:Fallback] Completed in ${Math.round(endTime - startTime)}ms`)

    const response: FullTextBatchTranslationResponse = {
        translations,
        sourceLanguage,
        targetLanguage,
    }

    if (hasUsage) {
        response.usage = { promptTokens: totalPromptTokens, completionTokens: totalCompletionTokens, totalTokens }
    }

    return response
}
```

---

## 6. Extension: Handler Changes

### File: `src/2_background/handlers/FullTranslateBatchHandler.ts`

Replace the sequential `translateFragment()` loop with a single API call:

```typescript
/**
 * Full-Page Batch Translation Request Handler
 *
 * Handles batch translation requests from content script.
 * Uses the dedicated full-text-batch endpoint for LLM-level batching.
 */

import type { FullTranslateBatchRequestData, FullTranslateBatchResponseMessage } from "@/0_common/types"
import * as loggerModule from "@/0_common/utils/logger"
import * as serviceInitializer from "../services/ServiceInitializer"
import { post } from "@/5_backend/services/APIService"
import { TRANSLATION_API_ENDPOINTS } from "@/6_translate/constants/TranslationConstants"
import type {
    FullTextBatchApiRequest,
    FullTextBatchApiResponse,
} from "@/6_translate/types/TranslationApiTypes"

const logger = loggerModule.createLogger("FullTranslateBatchHandler")

/**
 * Handle batch translation request from content script.
 * Calls the dedicated full-text-batch endpoint (single LLM call for all texts).
 */
export async function handleFullTranslateBatchRequest(
    data: FullTranslateBatchRequestData,
    sendResponse: (response: FullTranslateBatchResponseMessage) => void,
): Promise<void> {
    try {
        await serviceInitializer.ensureCriticalServicesReady()
        serviceInitializer.startBackgroundWarmUp()

        logger.debug(`Batch translation request: ${data.texts.length} segments`)
        const startTime = performance.now()

        const apiRequest: FullTextBatchApiRequest = {
            texts: data.texts,
            sourceLanguage: data.sourceLang,
            targetLanguage: data.targetLang,
        }

        const response = await post<FullTextBatchApiResponse, FullTextBatchApiRequest>(
            TRANSLATION_API_ENDPOINTS.TRANSLATE_FULL_TEXT_BATCH,
            apiRequest
        )

        const elapsedMs = Math.round(performance.now() - startTime)
        logger.info(`[handleBatch] batch complete`, {
            total: data.texts.length,
            successCount: response.translations.length,
            elapsedMs,
        })

        sendResponse({
            success: true,
            translations: response.translations,
        })
    } catch (error) {
        logger.error("Batch translation failed:", error)
        sendResponse({
            success: false,
            error: error instanceof Error ? error.message : String(error),
        })
    }
}
```

### Key Changes from Current Implementation

1. **Removed**: sequential `for` loop over `data.texts[]`
2. **Removed**: individual `translateModule.translateFragment()` calls
3. **Added**: Single `post()` call to `TRANSLATE_FULL_TEXT_BATCH` endpoint
4. **Simplified**: No per-item try/catch needed — the backend handles fallback internally
5. **Error handling**: On full batch failure, sends `success: false` — the `BatchQueue` in content script will handle retry + individual fallback

---

## 7. Extension: New API Types & Constants

### File: `src/6_translate/constants/TranslationConstants.ts`

Add new endpoint constant:

```typescript
export const TRANSLATION_API_ENDPOINTS = {
    TRANSLATE: "/api/v1/translate",
    TRANSLATE_FRAGMENT: "/api/v1/translate/fragment",
    TRANSLATE_FULL_TEXT_BATCH: "/api/v1/translate/full-text-batch",  // NEW
    AUTO_CANDIDATES: "/api/v1/translate/auto-candidates",
} as const
```

### File: `src/6_translate/types/TranslationApiTypes.ts`

Add new API types:

```typescript
/**
 * Full-text batch translation API request
 */
export interface FullTextBatchApiRequest {
    /** Array of text segments to translate */
    texts: string[]
    /** Source language code (e.g. "en") */
    sourceLanguage: string
    /** Target language code (e.g. "zh") */
    targetLanguage: string
}

/**
 * Full-text batch translation API response data
 */
export interface FullTextBatchApiResponse {
    /** Array of translated texts, same order and length as input texts */
    translations: string[]
    /** Source language code */
    sourceLanguage: string
    /** Target language code */
    targetLanguage: string
    /** Aggregate token usage for the single LLM call */
    usage?: {
        promptTokens: number
        completionTokens: number
        totalTokens: number
    }
}
```

### File: `src/6_translate/index.ts`

Add exports for new types (if needed by other modules):

```typescript
export type { FullTextBatchApiRequest, FullTextBatchApiResponse } from "./types/TranslationApiTypes"
```

### BatchQueue (`src/11_full_translate/utils/BatchQueue.ts`)

**No changes needed.** The `BatchQueue` already:
- Sends `FullTranslateBatchRequestMessage` with `{ texts, sourceLang, targetLang }`
- Expects `FullTranslateBatchResponseMessage` with `{ success, translations? }`
- Has retry logic for `BatchCountMismatchError`
- Has fallback to individual translation

The response contract remains identical — the handler still returns the same `FullTranslateBatchResponseMessage` shape.

---

## 8. Error Handling & Fallback Strategy

### Multi-Layer Fallback Architecture

```
Layer 1: LLM Service (backend)
    ├── Attempt 1: Single LLM call with separator batching
    ├── Check: segment count == input count?
    │   ├── Yes → return result
    │   └── No → Retry once (Attempt 2)
    ├── Attempt 2: Same LLM call again
    │   ├── Match → return result
    │   └── Mismatch → throw BusinessError
    └── On any other LLM error → throw BusinessError

Layer 2: Translation Service (backend)
    ├── Try: FullTextBatchTranslationService.translateBatch()
    │   ├── Success → return batch result
    │   └── Failure → Fall back to individual translateFragment() calls
    └── translateBatchFallback(): Promise.allSettled, empty string for failures

Layer 3: Extension Background Handler
    ├── Try: POST /api/v1/translate/full-text-batch
    │   ├── Success → sendResponse({ success: true, translations })
    │   └── HTTP/Network error → sendResponse({ success: false, error })

Layer 4: Extension Content Script (BatchQueue)
    ├── executeBatch(): Send FULL_TRANSLATE_BATCH_REQUEST message
    │   ├── Success + count match → resolve all entry promises
    │   ├── Count mismatch → retry up to 3 times with exponential backoff
    │   └── All retries exhausted OR non-retryable error → fallbackToIndividual()
    └── fallbackToIndividual(): Send each text as a single-item batch
```

### Error Categories

| Error | Origin | Handling |
|-------|--------|----------|
| Segment count mismatch | LLM Service | Retry once (Layer 1), then BusinessError |
| LLM timeout | GenerationLLMService | BusinessError → Layer 2 fallback |
| LLM rate limit | GenerationLLMService | BusinessError → Layer 2 fallback |
| Content moderation | GenerationLLMService | BusinessError → propagate to client |
| Network error (ext→backend) | APIService | APIError → Layer 4 retry/fallback |
| Token expired | APIService | Auto-refresh + retry (built-in) |
| Rate limited (429) | Backend rate limiter | APIError(rateLimited) → client backoff |
| Validation error (400) | Controller | APIError(businessError) → client shows error |

### Token Tracking

- `FullTextBatchTranslationService` uses `GenerationLLMService.generateWithUsage()` which calls `TokenTracker.getInstance().record(usage)` automatically
- The response includes aggregate `usage` field for the single LLM call
- Backend `translateFullTextBatch()` logs usage per batch
- No double-counting: one LLM call = one usage record

---

## 9. File Change Summary

### Backend (translate-api) — Files to CREATE

| # | File Path | Description |
|---|-----------|-------------|
| 1 | `src/7_generate/services/FullTextBatchTranslation.service.ts` | New LLM service with separator-based batching |
| 2 | `resources/generate/full_text_batch/system_prompt.txt` | System prompt for batch translation |
| 3 | `resources/generate/full_text_batch/user_prompt_template.txt` | User prompt template |

### Backend (translate-api) — Files to MODIFY

| # | File Path | Change |
|---|-----------|--------|
| 4 | `src/1_translate/types/translation.d.ts` | Add `FullTextBatchTranslationRequest` and `FullTextBatchTranslationResponse` types |
| 5 | `src/1_translate/routes/index.ts` | Add `/full-text-batch` route with rate limiter |
| 6 | `src/1_translate/controllers/translation.controller.ts` | Add `translateFullTextBatchHandler()` |
| 7 | `src/1_translate/services/translation.service.ts` | Add `translateFullTextBatch()`, fallback logic, model config |

### Extension (tapword-translator) — Files to MODIFY

| # | File Path | Change |
|---|-----------|--------|
| 8 | `src/6_translate/constants/TranslationConstants.ts` | Add `TRANSLATE_FULL_TEXT_BATCH` endpoint |
| 9 | `src/6_translate/types/TranslationApiTypes.ts` | Add `FullTextBatchApiRequest`, `FullTextBatchApiResponse` |
| 10 | `src/2_background/handlers/FullTranslateBatchHandler.ts` | Replace sequential loop with single API call |
| 11 | `src/6_translate/index.ts` | Export new types |

---

## 10. API Examples

### Successful Request

```http
POST /api/v1/translate/full-text-batch HTTP/1.1
Authorization: Bearer eyJ...
Content-Type: application/json
x-client-version: 0.5.0

{
    "texts": [
        "The quick brown fox jumps over the lazy dog.",
        "Machine learning has revolutionized natural language processing.",
        "TypeScript adds static typing to JavaScript."
    ],
    "sourceLanguage": "en",
    "targetLanguage": "zh"
}
```

### Successful Response

```json
{
    "code": 0,
    "data": {
        "translations": [
            "敏捷的棕色狐狸跳过了懒狗。",
            "机器学习彻底改变了自然语言处理。",
            "TypeScript 为 JavaScript 添加了静态类型。"
        ],
        "sourceLanguage": "en",
        "targetLanguage": "zh",
        "usage": {
            "promptTokens": 285,
            "completionTokens": 62,
            "totalTokens": 347
        }
    },
    "message": "success"
}
```

### LLM Prompt (what gets sent to the LLM)

**System message** (from `system_prompt.txt`):
```
You are a professional translator.

## Task
Translate each text segment from the source language to the target language.
...
```

**User message** (rendered from template):
```
# Source Language
English

# Target Language
Chinese

# Number of Segments
3

# Text to Translate
The quick brown fox jumps over the lazy dog. %% Machine learning has revolutionized natural language processing. %% TypeScript adds static typing to JavaScript.
```

**LLM Response**:
```json
{"translations": "敏捷的棕色狐狸跳过了懒狗。 %% 机器学习彻底改变了自然语言处理。 %% TypeScript 为 JavaScript 添加了静态类型。"}
```

### Validation Error Response

```json
{
    "code": 400,
    "data": null,
    "message": "The 'texts' array must not exceed 10 items."
}
```

### Fallback Scenario (transparent to client)

If the LLM returns a wrong number of segments:
1. Backend retries once with same prompt
2. If still mismatched, backend falls back to individual `translateFragment()` calls
3. Client receives the same response format — indistinguishable from a successful batch
4. Token usage reflects the aggregate of all individual calls

---

## Appendix: Environment Variables

### New Optional Env Vars (backend)

| Variable | Purpose | Fallback |
|----------|---------|----------|
| `BIANLIAN_API_MODEL_FAST` | Faster/cheaper model for full-text batch (e.g. `qwen-turbo`) | `BIANLIAN_API_MODEL` |
| `ATLAS_CLOUD_MODEL_FAST` | Faster/cheaper model for non-China region | `ATLAS_CLOUD_MODEL` |

These are optional. If not set, the service uses the same model as fragment translation. Setting them allows cost optimization by using a simpler model for paragraph-level translation where quality requirements are lower than for word/fragment translation.
