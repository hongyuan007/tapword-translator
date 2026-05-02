# Technical Spec: Add Traditional Chinese (zh-TW) Translation Target Language

**Issue**: [#23 — [FEATURE] 翻译目标语言支持繁体中文](https://github.com/jiaoding-tech/tapword-translator/issues/23)
**Date**: 2026-03-22
**Author**: Phase 1 Research (subagent)

---

## 1. Current State Analysis

### 1.1 Target Language Definition

Target languages are defined in **three places** with no centralized enum/constant:

| Location | How languages are listed | Current zh support |
|---|---|---|
| `src/0_common/utils/storageManager.ts` L249 | `SUPPORTED_LANGUAGES` array for new-user auto-detect | `"zh"` |
| `src/3_popup/index.html` L53-60 | Hardcoded `<option>` elements in `<select>` | `<option value="zh">中文</option>` |
| `src/4_options/index.html` L67-74 | Hardcoded `<option>` elements in `<select>` (duplicated) | `<option value="zh">中文</option>` |

**No centralized language registry exists.** Adding a language requires touching 3+ files manually.

### 1.2 UserSettings Type

`src/0_common/types/index.ts` — `targetLanguage: string` (free-form string, not an enum). Default: `"en"` (dynamically overridden by `detectBrowserLanguage()`).

### 1.3 Browser Language Detection

`src/0_common/utils/storageManager.ts` `detectBrowserLanguage()`:
- Extracts primary subtag from `navigator.language` (e.g., `zh-CN` → `zh`)
- Matches against `SUPPORTED_LANGUAGES = ["en", "zh", "es", "ja", "fr", "de", "ko", "ru"]`
- `zh-TW` browsers would currently map to `zh` (Simplified Chinese) — **this is the core UX bug**

### 1.4 Translation Pipeline (how targetLanguage flows)

1. **Content script** (`src/1_content/handlers/TranslationPipeline.ts`) reads `targetLanguage` from UserSettings → sends via `chrome.runtime.sendMessage`
2. **Background service worker** (`src/6_translate/services/TranslationService.ts`) receives `TranslateParams.targetLanguage`, defaults to `"zh"`
3. For **Official Cloud API**: sends `targetLanguage` as-is in `POST /api/v1/translate` JSON body
4. For **Custom API / Local LLM** (`src/8_generate/`): passes `targetLanguage` to prompt builder
5. For **MTranServer / Bing Translate**: passes `targetLanguage` directly to external API

### 1.5 Backend (translate-api) Language Handling

The backend is **already prepared** for zh-TW:

- `src/1_translate/utils/languageMapper.ts` has `zh-tw` entry: `{ code: "zh-tw", name: "Traditional Chinese", nativeName: "繁體中文" }`
- `openai.service.ts` `loadFewshot()` normalizes `zh-TW` → `zh` by stripping region (L57-58), falling back to Simplified Chinese fewshot — **this means translations will be in simplified Chinese unless the prompt explicitly requests traditional**
- Translation prompts use `getLanguageNames()` which correctly maps `zh-tw` → `"Traditional Chinese"` — the prompt will say "translate to Traditional Chinese", which LLMs generally handle well
- No `zh-tw` fewshot files exist under `resources/generate/` — fewshots will fallback to `zh/` (simplified Chinese examples). This is acceptable since LLMs understand the target language instruction.
- `chineseDefinition` from ECDict is always simplified — this is a **known limitation**, not a blocker

### 1.6 _locales (Chrome Extension i18n)

`src/_locales/` contains: `en`, `zh_CN`, `de`, `es`, `fr`, `ja`, `ko`, `ru`

These are **UI locale** files (extension name/description in Chrome Web Store), NOT translation target languages. They are separate concerns.

`src/0_common/locales/` contains in-app i18n: `en.json`, `zh.json`, etc. — same separation.

**Adding zh-TW as a translation target does NOT require new _locales folders.** A `zh_TW` locale folder would only be needed if we want the extension UI itself in Traditional Chinese, which is a separate feature.

### 1.7 Language Display

`src/0_common/utils/languageDisplay.ts` — uses `Intl.DisplayNames` with fallback to `LANGUAGE_NAME_MAP`. Adding `zh-tw` to the map ensures consistent display across all environments.

### 1.8 languageDetector / languageValidator

`src/1_content/utils/languageDetector.ts` L132: CJK detection maps `zho`/`cmn` → `"zh"`. The `resolveTargetLanguage()` function handles same-language suppression. `zh-TW` would need to be recognized as distinct from `zh` for the suppress-native-language feature.

---

## 2. Proposed Changes

### 2.1 Frontend (tapword-translator)

#### A. Create Centralized Language Registry — NEW FILE
**File**: `src/0_common/constants/languages.ts`

```typescript
export interface TargetLanguageOption {
    code: string       // API value: "zh", "zh-tw", "en", etc.
    display: string    // UI label: "中文（简体）", "中文（繁體）"
}

export const TARGET_LANGUAGES: TargetLanguageOption[] = [
    { code: "en",  display: "English" },
    { code: "zh",  display: "中文（简体）" },
    { code: "zh-tw", display: "中文（繁體）" },
    { code: "es",  display: "Español" },
    { code: "ja",  display: "日本語" },
    { code: "fr",  display: "Français" },
    { code: "de",  display: "Deutsch" },
    { code: "ko",  display: "한국어" },
    { code: "ru",  display: "Русский" },
]

export const TARGET_LANGUAGE_CODES = TARGET_LANGUAGES.map(l => l.code)
```

#### B. Update `src/0_common/utils/storageManager.ts`
- `detectBrowserLanguage()`: After extracting primary subtag, add special case: if `navigator.language` starts with `zh-TW` or `zh-HK`, return `"zh-tw"` instead of `"zh"`
- Replace hardcoded `SUPPORTED_LANGUAGES` with import from centralized registry
- Validate `targetLanguage` against `TARGET_LANGUAGE_CODES` in `normalizeUserSettings()`

#### C. Update `src/3_popup/index.html` L53-60
- Change `<option value="zh">中文</option>` → `<option value="zh">中文（简体）</option>`
- Add `<option value="zh-tw">中文（繁體）</option>` after it

#### D. Update `src/4_options/index.html` L67-74
- Same changes as popup (duplicate code — consider refactoring to JS-rendered select, but out of scope for this issue)

#### E. Update `src/0_common/utils/languageDisplay.ts`
- Add `zh-tw: "繁體中文"` to `LANGUAGE_NAME_MAP`

#### F. Update `src/1_content/utils/languageDetector.ts`
- `resolveTargetLanguage()`: Treat `zh-tw` as distinct from `zh` for same-language suppression (a `zh-TW` source page should not suppress translation when target is `zh`, and vice versa)
- CJK language detection: when target is `zh-tw`, map detected `zho`/`cmn` → source `"zh"` (not `"zh-tw"`) since source detection doesn't distinguish variants

#### G. Update `src/6_translate/services/BingTranslateService.ts` (if applicable)
- Verify Bing Translate API accepts `zh-TW` as a target language code. Bing uses `zh-Hant` — **may need a code mapping layer**

#### H. Update `src/6_translate/services/MTranServerService.ts` (if applicable)
- Verify MTranServer language code format for Traditional Chinese

### 2.2 Backend (translate-api) — Minimal Changes Needed

The backend already supports `zh-tw` in languageMapper. Changes:

#### A. Fewshot Fallback (Low Priority)
- Consider creating `resources/generate/word_translation/zh-tw/` and `resources/generate/fragment_translation_only/zh-tw/` with Traditional Chinese fewshot examples
- **Can defer**: current fallback to `zh/` fewshots works because the prompt explicitly says "Traditional Chinese"

#### B. `chineseDefinition` Field (No Change Needed)
- ECDict always returns simplified Chinese definitions — this is expected behavior
- The `targetDefinition` field (FreeDict) could provide zh-tw definitions if FreeDict has `eng-zho` coverage, but FreeDict doesn't distinguish simplified/traditional

### 2.3 Manifest Changes — NONE REQUIRED
- `manifest.json` uses `default_locale: "en"` for Chrome Web Store display
- `_locales/zh_TW/` would only be needed for UI localization (separate feature)

---

## 3. Risks & Edge Cases

### 3.1 Existing Users with `targetLanguage: "zh"`
- **No migration needed.** `"zh"` remains valid and maps to Simplified Chinese
- Existing users keep their current behavior

### 3.2 zh-TW Browser Auto-Detection
- Users with `navigator.language = "zh-TW"` currently get Simplified Chinese as default
- After fix, new users will correctly default to `"zh-tw"`
- **Risk**: Returning users who manually set `targetLanguage` won't be affected

### 3.3 Bing Translate Language Code
- Bing API uses `"zh-Hant"` for Traditional Chinese, not `"zh-TW"`
- **Must add a mapping**: `{ "zh-tw": "zh-Hant" }` in BingTranslateService
- Test with actual Bing API call

### 3.4 LLM Provider Consistency
- Different LLMs handle "Traditional Chinese" instruction with varying quality
- Some may mix simplified/traditional characters
- **Mitigation**: Prompt already uses explicit language name from languageMapper

### 3.5 Character Width / Layout
- Traditional Chinese characters are generally the same width as Simplified
- No layout changes expected in tooltip/popover
- Some Traditional Chinese characters are more complex (more strokes) — verify rendering in content script tooltips

### 3.6 FreeDict Dictionary
- FreeDict `eng-zho` doesn't distinguish simplified/traditional
- `targetDefinition` will be absent for `zh-tw` (acceptable — same as current `zh` behavior)

### 3.7 Duplicate Language Select HTML
- Popup and Options page have duplicated `<option>` lists
- **Not blocking** but creates maintenance burden
- Recommend follow-up: extract to shared JS template

---

## 4. Verification Plan

### 4.1 Unit Tests
- `storageManager.detectBrowserLanguage()`: mock `navigator.language = "zh-TW"` → assert returns `"zh-tw"`
- `languageDisplay.getLanguageDisplayName("zh-tw")` → returns `"繁體中文"`
- `languageDetector.resolveTargetLanguage()` with `sourceLanguage="zh"` + `targetLanguage="zh-tw"` → no suppression

### 4.2 Integration Tests (translate-api)
- `POST /api/v1/translate` with `targetLanguage: "zh-tw"` → returns Traditional Chinese text
- Verify `languageMapper.getLanguageName("zh-tw")` → `"Traditional Chinese"`

### 4.3 E2E / Manual Testing
1. Set browser language to `zh-TW` → fresh install → verify default target is "中文（繁體）"
2. Select a word on an English page → verify tooltip shows Traditional Chinese
3. Switch target to "中文（简体）" → verify simplified output
4. Switch target to "English" → verify English output
5. Test with each translation provider: Official, Custom API, MTranServer, Bing Translate
6. Test `suppressNativeLanguage` on a zh-TW website with target `zh-tw` → should suppress
7. Test `suppressNativeLanguage` on a zh-CN website with target `zh-tw` → should NOT suppress
8. Verify popup and options page both show the new option correctly

### 4.4 Regression
- Existing `zh` (Simplified Chinese) users: no behavior change
- All other target languages: no change
- Chrome Web Store listing: no change (no new `_locales/` folder)

---

## 5. Scope Summary

| Component | Effort | Risk |
|---|---|---|
| Centralized language registry (new) | Small | Low |
| storageManager detectBrowserLanguage | Small | Low |
| Popup HTML (add option) | Trivial | None |
| Options page HTML (add option) | Trivial | None |
| languageDisplay map | Trivial | None |
| languageDetector CJK handling | Small | Medium |
| BingTranslate code mapping | Small | Medium |
| Backend fewshot (optional/defer) | Medium | Low |
| Manifest / _locales | None | None |
| **Total Estimated Effort** | **~0.5 day** | |

**Recommendation**: This is a straightforward addition. The backend is already prepared. The main work is frontend: centralizing the language list, updating two HTML files, fixing browser detection for zh-TW, and adding provider-specific code mappings.
