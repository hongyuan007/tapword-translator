# Language Detection — Progress Log

## 2026-03-08: selectionLang short-word fix

### Problem
`chrome.i18n.detectLanguage` misidentifies short words (< ~15 chars). Log evidence:
- Word `"nominated"` (9 chars) → detected as `"la"` (Latin) instead of `"en"`
- Incorrect `sourceLanguage` sent to translation API, degrading quality

### Fix Applied
**File**: `src/1_content/handlers/TranslationPipeline.ts`

Changed `selectionLang` to use block context (`textForRouting`) instead of the raw selected text (`sanitizedText`):

```typescript
// Before
const selectionLang = await languageDetector.detectSourceLanguageAsync(sanitizedText)

// After
const selectionLang = await languageDetector.detectSourceLanguageAsync(textForRouting)
```

Also updated the `textForRouting` variable comment to reflect it is now shared by both `routingLang` and `selectionLang`.

### Analysis Document
See: `docs/plan/y2026/m02-language-detect/analysis/260308_1527_selectionlang-fix.md`

### Edge Cases Verified (by analysis)
| Scenario | Outcome |
|---|---|
| Short English word (`"nominated"`) on English page | ✅ Fixed: "la" → "en" |
| Short French word on French page | ✅ Improved reliability |
| CJK word (`"你好"`) | ✅ Unchanged (block context still "zh") |
| CJK+Latin, selecting Latin word (`"you"` from `"you今天来不来"`) | ✅ Returns "auto" → resolves to "zh" correctly |
| CJK+Latin, selecting whole mixed phrase | ✅ Returns "auto" → "zh" via `resolveTargetLanguage` |
| Long English sentence | ✅ Unchanged (both paths reliable for long text) |

### Build Status
`npm run build` → ✅ Pass (17ms incremental build)

### Risk
Low. Only potential regression is selecting a foreign-language term embedded in a same-block page written in a different language (e.g., English tech term in French prose). Impact is minor: LLM receives block language as source, but still produces correct translation given context.
