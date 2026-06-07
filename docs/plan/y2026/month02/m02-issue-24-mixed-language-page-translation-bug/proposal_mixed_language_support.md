# Technical Proposal: Auto-Detect Support for Translation Pipeline

## 1. Background & Objective
**Issue**: In mixed-language pages (e.g., Chinese page with English terms, or mixed phrases like "you什么时候来"), the current language detection and fallback logic is brittle.
- **Problem A**: Selecting an English word ("performance") in a Chinese block might be incorrectly routed or handled if detected as Chinese (triggering EN fallback) or English (triggering ZH translation). *Correction*: The original issue #24 was about English words being treated as Chinese context, causing wrong behavior.
- **Problem B**: Mixed phrases ("you什么时候来") need to be treated as a single unit ("Auto-Detect") to be translated correctly to the target language (e.g. "你什么时候来"), rather than being split or forcing a specific source language.
- **Solution**: Introduce a specific `auto` language code. When detected, the frontend bypasses standard fallback logic and delegates the translation strategy to the Backend LLM.

## 2. Architecture Changes

### 2.1. Frontend Detection Strategy (`src/1_content`)
Instead of forcing `en` when CJK text contains Latin characters (which breaks cases like "T恤"), we will explicitly label it as `auto`.

**Heuristic**:
If `detectSourceLanguageAsync` returns `zh`/`ja`/`ko` (CJK) **AND** the text contains Latin characters (`/[a-zA-Z]/`), set `sourceLanguage` to `"auto"`.
*Note: This is still a heuristic. Future improvements could verify the ratio of Latin vs CJK characters.*

### 2.2. Fallback Logic Adjustment
**Current Logic**: If `Source == Target`, switch Target (e.g., `zh` -> `en`).
**New Logic**: If `Source == "auto"`, **DO NOT** trigger fallback. Always send `Target = UserSettings.targetLanguage`.
*Reasoning*: "auto" implies the text is not "purely" the target language. The LLM is best suited to interpret the user's intent (usually unifying the language to the Target).

### 2.3. Backend / LLM Integration
- The frontend will send `sourceLanguage: "auto"` in the API request.
- **Remote Backend**: Must support `source_language="auto"`. (Assumed to be supported or handled by LLM prompt injection).
- **Local LLM (`8_generate`)**: The system prompt will receive "Auto-Detect" as the source language name.

## 3. Implementation Plan

### Step 1: Frontend Logic Update (`src/1_content`)

#### File: `src/1_content/handlers/TranslationPipeline.ts`
Modify `processTranslation` to set `selectionLang` to `"auto"` instead of `"en"` when the heuristic matches.

```typescript
// BEFORE
const selectionLang = (isCJKDetectedForSelection && /[a-zA-Z]/.test(sanitizedText)) ? "en" : rawSelectionLang

// AFTER
const selectionLang = (isCJKDetectedForSelection && /[a-zA-Z]/.test(sanitizedText)) ? "auto" : rawSelectionLang
```

#### File: `src/1_content/utils/languageDetector.ts`
Modify `resolveTargetLanguage` to handle `"auto"`.

```typescript
export function resolveTargetLanguage(sourceLanguage: string, targetLanguage: string): string {
    // ...
    // If source is mixed, trust the user's target language (let LLM handle it)
    if (sourceLanguage === "auto") {
        return targetLanguage;
    }
    // ... existing fallback logic
}
```

### Step 2: Local LLM Support (`src/8_generate`)

#### File: `src/8_generate/utils/languageUtils.ts`
Add mapping for `"auto"`.

```typescript
const LANGUAGE_NAMES: Record<string, string> = {
    // ...
    mixed: "Auto-Detect",
    // ...
}
```

## 4. Risks & Mitigations

### Risk: "T恤" Case (Mostly Chinese with Letters)
- **Scenario**: User selects "T恤", Target is Chinese (`zh`).
- **Behavior**: Source="auto", Target="zh". No Fallback.
- **Result**: Request sent to LLM: `Translate "T恤" (Mixed) to Chinese`.
- **Potential Outcome**: LLM might return "T恤" (same as input) because it's already Chinese.
- **Mitigation**: The Backend LLM Prompt should be robust enough to handle "Input is already in Target Language" by providing a definition or translating to English/Alternative. This depends on the Backend implementation. *For this proposal, we assume Backend handles `auto` intelligently.*

## 5. Verification
- **Test Case 1**: "you什么时候来" (Mixed) -> Target: ZH. Expect: "你什么时候来".
- **Test Case 2**: "performance" (En) -> Target: ZH. Expect: "性能". (Standard flow, `auto` logic shouldn't trigger if detection is `en`).
- **Test Case 3**: "T恤" (Mixed/Zh) -> Target: ZH. Verify behavior (LLM dependent).

