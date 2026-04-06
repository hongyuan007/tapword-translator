# Backend Bug Report: Missing Dictionary & Phonetics for English Words (Issue #29)

**Target Component**: `translate-api` (Backend Service)  
**Priority**: High (User Experience Impact)  
**Reporter**: Copilot (on behalf of Frontend Team)  
**Date**: 2026-03-04

## 1. Issue Description (Problem Phenomenon)

When the frontend requests a translation for an English word on a mixed-language page (e.g., Reddit with Chinese UI), the backend returns the AI translation but **misses the dictionary definition (ECDICT) and phonetic transcription**.

This causes the frontend word detail modal to look empty (missing `/phonetic/` and definitions), only showing the AI translation.

### Reproduction Payload

Sending `sourceLanguage: "auto"` (which frontend uses for mixed content) triggers the bug.

```json
POST /api/v1/translate
{
  "text": "believe",
  "sourceLanguage": "auto",  // <--- This causes the issue
  "targetLanguage": "zh",
  "context": "..."
}
```

**Actual Response (Buggy):**
```json
{
  "wordTranslation": "相信",
  "phonetic": null,           // <--- Missing
  "chineseDefinition": null   // <--- Missing
}
```

**Expected Response:**
```json
{
  "wordTranslation": "相信",
  "phonetic": "bɪˈliːv",
  "chineseDefinition": ["v. 相信; 认为...真实", ...]
}
```

---

## 2. Root Cause Analysis

The issue lies in `src/1_translate/services/translation.service.ts`.

The function `getDictionaryDefinition` has a strict check for `sourceLanguage !== "en"`.
When the frontend sends `"auto"` (introduced to handle mixed CJK/Latin content in PR #24), this check fails, and the function returns `null` immediately, skipping the dictionary lookup.

**File:** `src/1_translate/services/translation.service.ts`

```typescript
// Current Code (approx line 436)
private async getDictionaryDefinition(text: string, sourceLanguage: string, ...): Promise<any> {
    // ...
    // PROBLEM: strict check excludes "auto", even if text is English
    if (!dictionaryService.isSingleWord(text) || sourceLanguage !== "en") {
        return null; 
    }
    // ...
}
```

---

## 3. Recommended Fix

We should treat `sourceLanguage="auto"` as `"en"` for the purpose of dictionary lookup, provided the text itself is identified as a single word (which `isSingleWord` already checks).

**Proposed Change:**

```typescript
// In src/1_translate/services/translation.service.ts

private async getDictionaryDefinition(text: string, sourceLanguage: string, ...): Promise<any> {
    // ...
    
    // FIX: Map "auto" to "en" for dictionary lookup logic
    const effectiveSourceLanguage = sourceLanguage === "auto" ? "en" : sourceLanguage;

    if (!dictionaryService.isSingleWord(text) || effectiveSourceLanguage !== "en") {
        return null;
    }

    // ... continue with lookup
}
```

This change has been locally verified to restore the missing phonetic and dictionary data for requests with `sourceLanguage: "auto"`.
