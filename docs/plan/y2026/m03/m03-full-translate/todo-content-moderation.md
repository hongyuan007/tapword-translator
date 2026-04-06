# TODO: Handle LLM Content Moderation Blocking

## Problem
When translating certain web pages, some paragraphs contain content that triggers the LLM provider's content moderation filter (e.g., Alibaba Qwen's `data_inspection_failed`). This causes the batch translation to fail for that specific batch.

## Current Behavior
- The `FullTextBatchTranslation.service.ts` throws a `BusinessError` with message "Translation content was blocked by moderation."
- `translateFullTextBatch()` catches this and falls back to individual `translateFragment()` calls
- Individual fragments that contain the sensitive content will also fail
- The user sees untranslated paragraphs with no explanation

## Error Details (from logs)
```
[generate.llm] Generation provider error: BadRequestError: 400 Input data may contain inappropriate content.
  type: 'data_inspection_failed',
  code: 'data_inspection_failed'

[translation.service] [FullTextBatch] Batch failed, falling back to individual translations: BusinessError: Translation content was blocked by moderation.
```

## Proposed Solutions

### Option A: Isolate and Skip (Recommended)
- When batch fails with moderation error, fall back to individual translations
- For each individual translation that fails with moderation → return the original text untranslated
- Log a warning but don't break the overall translation flow
- The current fallback already does this partially — just need to ensure individual failures don't propagate

### Option B: Content Pre-filtering
- Before sending to LLM, filter out texts that might trigger moderation
- Difficult to implement accurately — moderation rules vary by provider

### Option C: Switch Provider on Failure
- If one provider blocks content, retry with a different provider that has more permissive moderation
- Adds complexity but improves coverage

## Priority
P2 — The current fallback behavior is acceptable for now. Only a small percentage of paragraphs are typically blocked.

## Related Files
- `translate-api/src/7_generate/services/FullTextBatchTranslation.service.ts`
- `translate-api/src/7_generate/services/llm/generationLLM.service.ts` (error handling)
- `translate-api/src/1_translate/services/translation.service.ts` (fallback logic)
