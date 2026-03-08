# PR #17: 添加Mtranserver与必应翻译支持

## Metadata
| Field | Value |
|-------|-------|
| Status | OPEN |
| Author | Huchangzhi |
| Created | 2026-02-19T04:04:49Z |
| Updated | 2026-03-05T14:45:20Z |
| URL | https://github.com/hongyuan007/tapword-translator/pull/17 |
| Labels | _(none)_ |

## Description

支持使用 https://github.com/xxnuo/MTranServer 进行翻译

Mtranserver翻译速度快，资源占用低，试了一下，还是挺适合这个项目的，LLM成本太高了

注：代码由AI生成

## General Comments (15 comments)

### Comment by **Huchangzhi** — 2026-02-19T04:11:49Z
i18n似乎被AI改的有点多...

---

### Comment by **hongyuan007** — 2026-02-21T09:27:26Z
看了Mtranserver介绍，看起来适合翻译句子，但是不能结合上下文翻译单词和短语

---

### Comment by **Huchangzhi** — 2026-02-21T10:28:05Z
确实上下文有所欠缺，自己用了一段时间，感觉还行吧，虽然比LLM差些，但是胜在速度快，成本低，自部署也很简单，~~还能薅官方demo用~~

---

### Comment by **Huchangzhi** — 2026-02-22T14:47:07Z
@hongyuan007 要不当个beta功能，看看其他人的评价

---

### Comment by **hongyuan007** — 2026-02-24T08:11:34Z
> @hongyuan007 要不当个beta功能，看看其他人的评价

可以的，周末我再看看pr

---

### Comment by **Huchangzhi** — 2026-02-24T10:20:20Z
可能语言文件有点被AI改炸了，可能要修改修改

---

### Comment by **hongyuan007** — 2026-03-03T10:10:51Z
看了下翻译效果还不错，感谢贡献，后面我会合并到 release/0.4.2，有空可以处理一下下面的问题：

1. 代码冲突

2. locale 配置文件：只改需要改的 key（MTranServer 相关的新增项）

3. 设置页面 UI 需要调整下，有时间你可以改一版（参考下面的截图），如果你不确定怎么改的话可以不改，0.4.2发版前，我会统一调整设置项的ui

---

### Comment by **Huchangzhi** — 2026-03-03T14:54:34Z
@hongyuan007  修复了提到的问题，还有copilot的问题

---

### Comment by **Huchangzhi** — 2026-03-03T14:57:15Z
完了，翻译好像丢了..........

---

### Comment by **Huchangzhi** — 2026-03-03T15:13:06Z
救回来了，现在怎么样

---

### Comment by **Huchangzhi** — 2026-03-03T15:14:45Z
UI也修了

---

### Comment by **Huchangzhi** — 2026-03-05T06:03:43Z
参考 https://github.com/plainheart/bing-translate-api 添加了bing翻译

---

### Comment by **Huchangzhi** — 2026-03-05T06:03:59Z
翻译效果将就，但是方便

---

### Comment by **Huchangzhi** — 2026-03-05T14:41:32Z
试了一下，必应翻译可以正常用了

---

### Comment by **Huchangzhi** — 2026-03-05T14:45:20Z
必应翻译效果（截图）

---

## Review Summaries

### Review by **copilot-pull-request-reviewer** (COMMENTED) — 2026-03-03T10:20:56Z

## Pull request overview

该 PR 为现有翻译模块新增 **MTranServer（自建）** 翻译能力，并在设置页引入"翻译服务提供方"选择，以便在官方云翻译 / 自定义 LLM API / MTranServer 之间切换，从而降低翻译成本与资源占用。

**Changes:**
- 新增 `MTranServerService`：通过自建 MTranServer `/translate` 接口进行翻译与连通性测试
- `TranslationService` 按 `translationProvider` 路由到 MTranServer / Custom API / 官方云翻译，并增加对应错误处理
- Options 设置页新增 provider 下拉选择 + MTranServer 配置与测试入口；存储层新增迁移（legacy `useCustomApi` → `translationProvider`）与 `mtranserver` 设置结构；多语言文案更新

### Reviewed changes

Copilot reviewed 15 out of 16 changed files in this pull request and generated 7 comments.

| File | Description |
| ---- | ----------- |
| src/6_translate/services/TranslationService.ts | 按 provider 路由翻译实现，新增 MTranServer 分支与错误转换 |
| src/6_translate/services/MTranServerService.ts | 新增 MTranServer 请求封装、语言码映射与连通性测试 |
| src/4_options/modules/settingsManager.ts | 设置页新增 provider UI 逻辑、MTranServer 配置保存与测试按钮逻辑 |
| src/4_options/index.ts | 初始化时注册 MTranServer 测试逻辑 |
| src/4_options/index.html | 新增"Translation Provider"选择器、MTranServer 配置卡片与测试按钮 |
| src/0_common/utils/storageManager.ts | 新增 `mtranserver` 合并/归一化；迁移 legacy `useCustomApi` 到 `translationProvider` |
| src/0_common/types/index.ts | 新增 `TranslationProvider`、`MTranserverSettings`，并扩展 `UserSettings` 默认值 |
| src/0_common/locales/{zh,en,ru,ko,ja,fr,es,de}.json | 增加 provider/MTranServer 文案与错误提示；同时包含部分非直接相关文案调整 |
| .gitignore | 格式化调整（对齐/缩进） |

---

## Inline Code Comments (7 comments)

### `src/6_translate/services/TranslationService.ts` (line: _diff context_)
> `contextInfo` is destructured from `params` in the MTranServer branch but never used. With `noUnusedLocals` enabled in tsconfig, this will fail the TypeScript build; remove it from the destructuring (or use it) to satisfy the compiler.
>
> **Suggestion:**
> ```ts
> const { word, leadingText, trailingText, sourceLanguage, targetLanguage = "zh" } = params
> ```

— **Copilot** at 2026-03-03T10:20:54Z

---

### `src/6_translate/services/MTranServerService.ts` (line 205)
> `sourceLanguage` parameter is declared but never used inside `translateWithMTranServer`. With `noUnusedParameters: true`, this will break the TypeScript build; either remove the parameter from the function signature/call sites or actually use it (e.g., map it and send as `from` when provided).

— **Copilot** at 2026-03-03T10:20:54Z

---

### `src/6_translate/services/MTranServerService.ts` (line 236)
> The MTranServer requests use `fetch` without any timeout/AbortController. If the self-hosted service is unreachable, these calls can hang for a long time and block the translation flow; consider adding an AbortController with a reasonable timeout (consistent with `APIService`'s timeout handling) and surface a friendly error when the timeout triggers.

— **Copilot** at 2026-03-03T10:20:55Z

---

### `src/0_common/utils/storageManager.ts` (line 111)
> `normalizedTranslationProvider` currently defaults to "official" for all users. In community builds, `ServiceInitializer` can run without build-time credentials (API service not initialized), so selecting/landing on the official cloud provider will make translations fail. Consider using the existing `isCommunityEdition` flag here to default (and/or force) `translationProvider` to a self-provided option (e.g., "customApi" or "mtranserver") for community edition, and remove/repurpose `isCommunityEdition` so it isn't left unused (noUnusedLocals).

— **Copilot** at 2026-03-03T10:20:55Z

---

### `src/4_options/modules/settingsManager.ts` (line 259)
> `setCustomApiControlsEnabled()` was removed, but `CUSTOM_API_CONTROL_SELECTOR` is still declared at the top of this module and is no longer referenced. With `noUnusedLocals: true` this will fail the TypeScript build; remove the constant (or reintroduce a use) to keep the file compiling.

— **Copilot** at 2026-03-03T10:20:55Z

---

### `src/0_common/locales/en.json` (line: _diff context_)
> This PR is described as adding MTranServer support, but this locale file also changes a number of unrelated UI strings (modal button labels/sections, update copy, etc.). Consider limiting the scope of this PR to provider-related strings only (or moving the broader translation/copy edits into a separate PR) to reduce risk and review surface.

— **Copilot** at 2026-03-03T10:20:55Z

---

### `src/6_translate/services/TranslationService.ts` (line 293)
> New provider routing logic for "mtranserver" is introduced here, but there are existing test suites for `TranslationService` under `tests/6_translate/services/`. Please add/extend tests to cover: (1) selecting `translationProvider="mtranserver"` routes to `translateWithMTranServer`, (2) missing URL throws the expected `TranslationError` i18n keys, and (3) `MTranServerError` is converted to a user-facing `TranslationError`.
>
> **Suggestion:**
> ```ts
>             try {
>                 // Translate the word itself
>                 const wordTranslation = await translateWithMTranServer(
>                     word,
>                     sourceLanguage,
>                     targetLanguage,
>                     mtranserverSettings
>                 )
>
>                 // Translate full sentence if context is available
>                 let sentenceTranslation: string | undefined
>                 if (leadingText || trailingText) {
>                     const fullSentence = `${leadingText || ""}${word}${trailingText || ""}`
>                     sentenceTranslation = await translateWithMTranServer(
>                         fullSentence,
>                         sourceLanguage,
>                         targetLanguage,
>                         mtranserverSettings
>                     )
>                 }
>
>                 return {
>                     wordTranslation: wordTranslation,
>                     sentenceTranslation: sentenceTranslation,
>                     chineseDefinition: undefined,
>                     englishDefinition: undefined,
>                     targetDefinition: undefined,
>                     lemma: undefined,
>                     phonetic: undefined,
>                     lemmaPhonetic: undefined,
>                 }
>             } catch (error) {
>                 if (error instanceof MTranServerError) {
>                     // Convert low-level MTranServerError to a user-facing TranslationError
>                     throw new TranslationError(
>                         i18nModule.translate("error.mtranserverTranslationFailed"),
>                         i18nModule.translate("error.short.mtranserverTranslationFailed")
>                     )
>                 }
>                 throw error
> ```

— **Copilot** at 2026-03-03T10:20:56Z

---

## Changed Files (18 files)
| File | +Additions | -Deletions |
|------|-----------|-----------|
| package-lock.json | +26 | -0 |
| package.json | +7 | -11 |
| src/0_common/locales/de.json | +48 | -2 |
| src/0_common/locales/en.json | +34 | -2 |
| src/0_common/locales/es.json | +48 | -2 |
| src/0_common/locales/fr.json | +48 | -2 |
| src/0_common/locales/ja.json | +48 | -2 |
| src/0_common/locales/ko.json | +48 | -2 |
| src/0_common/locales/ru.json | +48 | -2 |
| src/0_common/locales/zh.json | +34 | -2 |
| src/0_common/types/index.ts | +38 | -3 |
| src/0_common/utils/storageManager.ts | +28 | -1 |
| src/4_options/index.html | +82 | -13 |
| src/4_options/index.ts | +2 | -0 |
| src/4_options/modules/settingsManager.ts | +175 | -89 |
| src/6_translate/services/BingTranslateService.ts | +338 | -0 |
| src/6_translate/services/MTranServerService.ts | +264 | -0 |
| src/6_translate/services/TranslationService.ts | +199 | -6 |
