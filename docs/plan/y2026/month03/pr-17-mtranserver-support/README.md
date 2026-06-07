# PR #17: 添加Mtranserver支持

## Metadata
| Field | Value |
|-------|-------|
| Status | OPEN |
| Author | Huchangzhi (编程小白) |
| Created | 2026-02-19T04:04:49Z |
| Updated | 2026-02-24T10:20:20Z |
| URL | https://github.com/hongyuan007/tapword-translator/pull/17 |
| Labels | _(none)_ |

## Description

支持使用 https://github.com/xxnuo/MTranServer 进行翻译

MTranServer 翻译速度快，资源占用低，试了一下，还是挺适合这个项目的，LLM 成本太高了

注：代码由 AI 生成

## Review Summaries

_(No formal reviews submitted)_

## General Comments (6 comments)

### Comment by **Huchangzhi** — 2026-02-19T04:11:49Z
i18n 似乎被 AI 改的有点多...

---

### Comment by **hongyuan007** — 2026-02-21T09:27:26Z
看了 Mtranserver 介绍，看起来适合翻译句子，但是不能结合上下文翻译单词和短语

---

### Comment by **Huchangzhi** — 2026-02-21T10:28:05Z
确实上下文有所欠缺，自己用了一段时间，感觉还行吧，虽然比 LLM 差些，但是胜在速度快，成本低，自部署也很简单，~~还能薅官方 demo 用~~

---

### Comment by **Huchangzhi** — 2026-02-22T14:47:07Z
@hongyuan007 要不当个 beta 功能，看看其他人的评价

---

### Comment by **hongyuan007** — 2026-02-24T08:11:34Z
> @hongyuan007 要不当个 beta 功能，看看其他人的评价

可以的，周末我再看看 pr

---

### Comment by **Huchangzhi** — 2026-02-24T10:20:20Z
可能语言文件有点被 AI 改炸了，可能要修改修改

---

## Inline Code Comments

_(No inline code comments)_

## Changed Files (16 files)

| File | +Additions | -Deletions |
|------|-----------|-----------|
| .gitignore | +1 | -1 |
| src/0_common/locales/de.json | +43 | -7 |
| src/0_common/locales/en.json | +52 | -33 |
| src/0_common/locales/es.json | +42 | -6 |
| src/0_common/locales/fr.json | +42 | -6 |
| src/0_common/locales/ja.json | +55 | -19 |
| src/0_common/locales/ko.json | +46 | -10 |
| src/0_common/locales/ru.json | +71 | -35 |
| src/0_common/locales/zh.json | +33 | -14 |
| src/0_common/types/index.ts | +27 | -3 |
| src/0_common/utils/storageManager.ts | +22 | -1 |
| src/4_options/index.html | +59 | -12 |
| src/4_options/index.ts | +1 | -0 |
| src/4_options/modules/settingsManager.ts | +108 | -88 |
| src/6_translate/services/MTranServerService.ts | +244 | -0 |
| src/6_translate/services/TranslationService.ts | +120 | -6 |

## Detailed Code Analysis

### 1. New File: `src/6_translate/services/MTranServerService.ts` (+244 lines)

A brand-new service file implementing the MTranServer backend.

**Key components:**
- `LANGUAGE_CODE_MAP`: Maps internal language codes to MTranServer codes (e.g. `zh` → `zh-Hans`). Covers 70+ languages.
- `translateWithMTranServer(text, sourceLanguage, targetLanguage, settings)`: Core translation function. Always sends `from: "auto"` for source language detection.
- `testMTranServerConnection(settings)`: Tests connectivity by sending a "hello" translation test request.
- `MTranServerError`: Custom error class carrying `statusCode` and `responseBody` for error handling.
- Auth: supports optional Bearer token via `Authorization` header.
- API endpoint: `POST {url}/translate` with body `{ from, to, text }`.

---

### 2. Type System: `src/0_common/types/index.ts` (+27 lines)

**Architectural change**: replaced the boolean `useCustomApi` flag with a proper enum type:

```typescript
// Before
customApi: { useCustomApi: boolean, ... }

// After
translationProvider: "official" | "customApi" | "mtranserver"
```

New additions:
- `TranslationProvider` union type (`"official" | "customApi" | "mtranserver"`)
- `MTranserverSettings` interface: `{ url: string, key: string, enabled: boolean }`
- New field `translationProvider` and `mtranserver` added to `UserSettings`
- Default: `translationProvider: "official"`, `mtranserver: { url: "http://127.0.0.1:8989", key: "", enabled: false }`

---

### 3. Storage: `src/0_common/utils/storageManager.ts` (+22 lines)

- Added normalization for `MTranserverSettings`
- **Migration logic**: if legacy `customApi.useCustomApi === true` exists in stored settings, automatically migrates to `translationProvider: "customApi"` — backward compatible

---

### 4. Translation Routing: `src/6_translate/services/TranslationService.ts` (+120 lines)

Both `translateWord()` and `translateFragment()` now use a provider-switch pattern:

```typescript
const provider = userSettings.translationProvider

if (provider === "mtranserver") { /* MTranServer path */ }
if (provider === "customApi") { /* LLM path */ }
// else: official cloud API (default)
```

MTranServer path behavior:
- Translates the word/fragment itself
- Also translates the full sentence (`leadingText + word + trailingText`) if context is available
- Returns standard `TranslationResult` shape (no phonetic, lemma, or dictionary definitions)

`buildLocalLlmConfig()` updated: now checks `translationProvider !== "customApi"` instead of `!customApi.useCustomApi`.

---

### 5. Options UI: `src/4_options/index.html` + `settingsManager.ts` (+196 lines net)

- New "翻译服务" section with a dropdown to select `official / customApi / mtranserver`
- MTranServer sub-section: URL input, API Key input, "测试连接" button
- CustomApi sub-section: reorganized, now clearly labeled
- The UI shows/hides sections based on the `translationProvider` selection

---

### 6. i18n Locales (+335 lines across 8 languages)

New keys added:
- `popup.translationProvider.*` — dropdown options
- `popup.mtranserver.*` — MTranServer settings UI labels
- `error.short.mtranserverConfigMissing`, `error.short.mtranserverError` — error messages
- Existing keys renamed/reworded (e.g. `popup.section.customApi` description updated)

⚠️ **Known issue**: Author acknowledges locale files may be over-edited by AI, requiring manual review.

---

## Summary

This PR adds support for [MTranServer](https://github.com/xxnuo/MTranServer) as a new translation backend. MTranServer is a self-hostable, fast, low-resource-usage translation server.

**Architecture**: introduces a `translationProvider` selector (`official | customApi | mtranserver`), replacing the old boolean `useCustomApi` flag — a cleaner design that is extensible for future providers.

**Discussion summary:**
- Owner concern: MTranServer lacks contextual awareness for word/phrase translation (vs. LLM-based approach)
- Proposal: ship as a **beta feature** to gather user feedback
- Known issue: locale files may need manual cleanup (over-edited by AI)
