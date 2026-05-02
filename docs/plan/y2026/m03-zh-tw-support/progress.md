# Progress: m03-zh-tw-support (Issue #23)

## Task
Add Traditional Chinese (zh-TW) as a supported target language for translation.

## Source
- GitHub Issue: #23 — [FEATURE] 翻译目标语言支持繁体中文

## Phases
- [x] Phase 1: Research & Spec
- [x] Phase 2: Implementation
- [ ] Phase 3: Verification
- [ ] Phase 4: Review

## Phase 2 Implementation Log (2026-03-22)

### Files Created
| File | Change |
|---|---|
| `src/0_common/constants/languages.ts` | NEW — Centralized `TARGET_LANGUAGES` array and `TARGET_LANGUAGE_CODES` string[] |

### Files Modified
| File | Change |
|---|---|
| `src/0_common/utils/storageManager.ts` | Import `TARGET_LANGUAGE_CODES`; `detectBrowserLanguage()` now detects zh-TW/zh-HK/zh-Hant browsers → `"zh-tw"`; replaced hardcoded `SUPPORTED_LANGUAGES` with registry import |
| `src/3_popup/index.html` | Changed `中文` → `中文（简体）`; added `<option value="zh-tw">中文（繁體）</option>` |
| `src/4_options/index.html` | Same changes as popup |
| `src/0_common/utils/languageDisplay.ts` | Added `"zh-tw": "繁體中文"` to `LANGUAGE_NAME_MAP` |
| `src/1_content/utils/languageDetector.ts` | Added comment clarifying zh/zh-tw are naturally distinct (source detection returns "zh", never "zh-tw") |
| `src/6_translate/services/BingTranslateService.ts` | Added `"zh-tw": "zh-Hant"` to `LANGUAGE_CODE_MAP` |
| `src/6_translate/services/MTranServerService.ts` | Added `"zh-tw": "zh-Hant"` to `LANGUAGE_CODE_MAP` |

### Design Decisions
- **No `normalizeLangCode()` change needed**: Source language detection (Chrome/franc) returns `"zh"` for all Chinese variants. The `resolveTargetLanguage()` comparison `"zh" !== "zh-tw"` naturally prevents same-language suppression across variants.
- **`detectBrowserLanguage()`**: Checks for `zh-TW`, `zh-HK`, `zh-Hant`, `zh-MO` prefixes to map to `"zh-tw"`.
- **No changes needed to `normalizeUserSettings()`**: `targetLanguage` is a free-form string; the select options in HTML enforce valid values.
