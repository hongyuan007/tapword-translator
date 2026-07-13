# PR #65 × PR #60 兼容性调研报告

> **调研日期**: 2026-06-14
> **调研范围**: PR #65「繁体中文支持」(分支 `feat/260613/traditional-chinese-support`) 与 PR #60「全文翻译+多Provider」(已合入 main, commit `6b93cb9`) 的代码兼容性
> **结论**: ✅ 整体兼容，有 2 个低风险改进建议（不影响合并）

---

## 一、PR #65 改动清单

| 文件 | 改动类型 | 摘要 |
|------|----------|------|
| `src/0_common/utils/languageDisplay.ts` | **修改** | 添加 `"zh-hant": "繁體中文"` 到 LANGUAGE_NAME_MAP |
| `src/0_common/utils/languageTagUtils.ts` | **新增** | BCP 47 语言标签工具：`normalizeLanguageTagFull`、`normalizeLocaleMeta`、`isTraditionalChinese`、`getMainSubtag`、`isSameLanguage`。区分简体/繁体中文 |
| `src/0_common/utils/storageManager.ts` | **修改** | `detectBrowserLanguage()` 增加 zh-Hant 精确匹配逻辑（zh-tw/zh-hk/zh-hant → "zh-Hant"） |
| `src/11_full_translate/dom/translationWalker.ts` | **修改** | `shouldSkipChineseTargetLanguageText()` 增加 zh-Hant 分支：仅跳过已含繁体字的文本，简体文本仍需翻译 |
| `src/1_content/utils/languageValidator.ts` | **修改** | 重构 zh 分支：选中文本/页面声明语言/上下文均区分简繁体；新增 `detectChineseScript()` + `TRADITIONAL_ONLY_CHARS` 字符集 |
| `src/1_content/utils/pageLanguageChecker.ts` | **修改** | 迁移到 `normalizeLanguageTagFull`/`normalizeLocaleMeta`/`isSameLanguage`，不再丢弃 subtag |
| `src/3_popup/index.html` | **修改** | 添加 `<option value="zh-Hant">繁體中文</option>` |
| `src/4_options/index.html` | **修改** | 添加 `<option value="zh-Hant">繁體中文</option>` |
| 测试文件 ×3 | **新增** | `traditional-chinese-support.test.ts`、`languageValidator.traditional-chinese.test.ts`、`languageValidator.unit.test.ts` 更新 |

**非源码改动**（docs/review 文件）不影响兼容性分析。

---

## 二、PR #60 新增模块概览（与 PR #65 相关部分）

PR #60 新增了完整的全文翻译管线和多 Provider 支持。以下模块与 PR #65 有直接或间接的交互：

| 模块/文件 | 角色 | 与 zh-Hant 的关系 |
|-----------|------|-------------------|
| `PageTranslationManager.ts` | 全文翻译编排器 | 通过 `config.targetLang` 传递目标语言到翻译管线 |
| `FullTranslateHandler.ts` | Content Script 层入口 | 从 `storageManager.getUserSettings()` 读取 `targetLanguage` 构建 config |
| `translationWalker.ts` | 翻译资格判断 | 被 `PageTranslationManager` 调用判断段落是否需要翻译 |
| `BatchQueue.ts` | 批量翻译队列 | 透传 `targetLang` 到 background |
| `FullTranslateBatchHandler.ts` | Background 路由 | 根据 provider 类型路由，透传 `targetLang` |
| Provider Services (Microsoft/Google/Bing/MTranServer) | 翻译执行 | 各自有 `LANGUAGE_CODE_MAP`，需确认覆盖 zh-Hant |
| `FullTextBatchGenerationService.ts` | Custom API LLM 翻译 | 使用 `languageUtils.getLanguageNames()` 获取语言名称 |
| `languageUtils.ts` | 语言名称映射 | 供 LLM prompt 使用 |
| `pageLanguageChecker.ts` | 页面语言检测 | 浮动按钮判断页面是否与目标语言相同 |
| `TranslationCache.ts` | 翻译缓存 | 缓存 key 包含 `targetLang`，不同语言自动隔离 |

---

## 三、调研要点逐项回答

### 要点 1：代码交叉分析

#### 1.1 `translationWalker.ts`（PR #65 修改） ↔ `PageTranslationManager.ts`（PR #60 新增）

**调用链**:
```
PageTranslationManager.translateSimpleParagraph(element)
  → shouldTranslateParagraph(text, minChars, minWords, this.config.targetLang)  // ← PR #65 改动点
    → shouldSkipChineseTargetLanguageText(text, targetLanguage)
      → 检查 targetLanguage 是否以 "zh" 开头
      → 如果是 zh-Hant（含 hant/tw/hk），进一步检查文本是否含繁体字
      → 含繁体字 → skip（已为目标语言）
      → 不含繁体字 → 不 skip（需要翻译 simp→trad）
```

**兼容性**: ✅ 完全兼容。`PageTranslationManager` 已经将 `this.config.targetLang` 传入 `shouldTranslateParagraph()`（PR #60 commit `cafe2e8` 添加）。PR #65 的改动在该函数内部增加了 zh-Hant 分支，调用方无需修改。

**源码引用**:
- `PageTranslationManager.ts` L152: `if (!shouldTranslateParagraph(text, this.config.minCharactersPerNode, this.config.minWordsPerNode, this.config.targetLang))`
- `translationWalker.ts` L78: `export function shouldTranslateParagraph(text, minChars, minWords, targetLanguage?: string)`
- `translationWalker.ts` L127-169: `shouldSkipChineseTargetLanguageText()` — PR #65 新增 zh-Hant 分支

#### 1.2 `languageValidator.ts`（PR #65 修改） ↔ `FullTranslateHandler.ts`（PR #60 新增）

**关系**: **无直接调用**。`languageValidator` 用于选中文本翻译（划词翻译场景），`FullTranslateHandler` 用于全文翻译场景。两者各自独立运行。

**间接交互**: 两者都读取同一个 `settings.targetLanguage`，PR #65 确保 `languageValidator` 正确区分简繁体，避免繁体中文页面上的选中文本被错误抑制。

#### 1.3 `pageLanguageChecker.ts`（PR #65 修改） ↔ `FloatingButtonManager`（PR #60 新增）

**调用链**:
```
FloatingButtonManager → FloatingButtonIntegration
  → isPageLanguageSameAsTarget(targetLanguage)  // 判断是否显示浮动按钮
    → getPageDeclaredLanguage() / detectLanguageFromContent()
    → isSameLanguage(declared, tgt)  // ← PR #65 新增的 zh 简繁区分
```

**兼容性**: ✅ 完全兼容。PR #65 将原来粗暴的 `split("-")[0]` 改为保留完整 subtag 并使用 `isSameLanguage()` 比较，对 zh-TW/zh-Hant 页面和 zh-Hant 目标语言的判断更精确。

#### 1.4 `languageTagUtils.ts`（PR #65 新增）↔ 多模块依赖

被 `languageValidator.ts` 和 `pageLanguageChecker.ts` 同时引用，提取为 `0_common/utils` 下的共享工具。符合编码规范的「基础设施纯净」原则。

#### 1.5 `storageManager.ts`（PR #65 修改）↔ `FullTranslateHandler.buildConfig()`

**调用链**:
```
FullTranslateHandler.buildConfig()
  → storageManager.getUserSettings()
    → 返回 settings.targetLanguage（可能是 "zh-Hant"）
  → config.targetLang = settings.targetLanguage || DEFAULT_TARGET_LANG
```

**兼容性**: ✅ 完全兼容。`detectBrowserLanguage()` PR #65 改动仅影响新用户的默认语言检测，不影响已有设置。`"zh-Hant"` 值在全文翻译管线中正确传递。

#### 交叉分析总结

| PR #65 文件 | PR #60 交互模块 | 交互类型 | 兼容性 |
|-------------|----------------|----------|--------|
| `translationWalker.ts` | `PageTranslationManager.ts` | 直接调用 | ✅ |
| `languageValidator.ts` | 无（划词翻译独立） | 无直接交互 | ✅ |
| `pageLanguageChecker.ts` | `FloatingButtonManager` | 间接调用 | ✅ |
| `languageTagUtils.ts` | 共享工具（新模块） | 被两个模块引用 | ✅ |
| `storageManager.ts` | `FullTranslateHandler.buildConfig()` | 数据源 | ✅ |
| `languageDisplay.ts` | UI 显示 | 纯展示 | ✅ |
| `popup/options HTML` | UI | 纯展示 | ✅ |

---

### 要点 2：功能兼容性

#### 2.1 全文翻译流程是否正确支持 zh-Hant 目标语言？

**端到端流程追踪**:

```
用户选择 "zh-Hant" → storageManager 存储 targetLanguage="zh-Hant"
  → FullTranslateHandler.buildConfig()
    → config.targetLang = "zh-Hant"
  → PageTranslationManager(config)
    → BatchQueue({ targetLang: "zh-Hant" })
    → shouldTranslateParagraph(text, ..., "zh-Hant")
      → shouldSkipChineseTargetLanguageText(text, "zh-Hant")
        → normalizedTarget = "zh" (split(/[-_]/)[0])
        → 匹配 CHINESE_TARGET_LANG = 'zh'
        → fullTarget = "zh-hant", isTraditionalTarget = true
        → 仅跳过含繁体字的文本 ✅
    → BatchQueue.enqueue(text)
      → chrome.runtime.sendMessage({ data: { targetLang: "zh-Hant", ... } })
      → FullTranslateBatchHandler → Provider → mapLanguageCode("zh-Hant")
```

**结论**: ✅ 完整支持。语言参数从 UI → storage → config → BatchQueue → Background → Provider 全链路透传，无断点。

#### 2.2 翻译引擎的 language 参数传递链是否有遗漏？

逐层检查：
1. `FullTranslateHandler.buildConfig()` → `settings.targetLanguage || DEFAULT_TARGET_LANG` ✅
2. `PageTranslationManager` → `this.config.targetLang` 传给 `shouldTranslateParagraph` ✅ 和 `BatchQueue` ✅
3. `BatchQueue` constructor → `this.targetLang = config.targetLang` ✅
4. `BatchQueue.executeBatch()` → message `data.targetLang = this.targetLang` ✅
5. `FullTranslateBatchHandler` → `data.targetLang` 透传到各 provider ✅

**无遗漏**。

#### 2.3 Provider 选择逻辑是否对 zh-Hant 有特殊处理？

Provider 选择完全基于 `settings.fullPageTranslationProvider`（如 "official"/"microsoftFree"/"googleFree"/"customId"），与目标语言无关。zh-Hant 不会触发不同的 provider 路由逻辑。✅ 正确。

---

### 要点 3：多 Provider 场景

#### 3.1 各 Provider 对 zh-Hant 的语言映射

| Provider | LANGUAGE_CODE_MAP["zh-Hant"] | 映射结果 | 覆盖状态 |
|----------|------------------------------|----------|----------|
| **MicrosoftFree** | `"zh-Hant"` | → `zh-Hant` | ✅ 已覆盖 |
| **GoogleFree** | `"zh-TW"` | → Google API `tl=zh-TW` | ✅ 已覆盖 |
| **BingTranslate** | `"zh-Hant"` | → `zh-Hant` | ✅ 已覆盖 |
| **MTranServer** | `"zh-Hant"` | → `zh-Hant` | ✅ 已覆盖 |
| **Official Cloud API** | 无映射（直接传 `data.targetLang`） | 透传 `"zh-Hant"` 到后端 | ✅ 透传 |
| **Custom API (LLM)** | 无映射（通过 prompt 传语言名） | 见下方风险点 | ⚠️ 见 3.3 |

#### 3.2 `languageValidator` 是否覆盖 zh-Hant？

✅ **已覆盖**。PR #65 对 `languageValidator.ts` 做了深度重构：
- 选中文本检测：`detectChineseScript(text)` 区分简繁体
- 页面声明语言：使用 `isSameLanguage(pageDeclaredLanguage, tgtLang)` 比较，不再粗暴 `split("-")[0]`
- 上下文检测：同样区分简繁体

#### 3.3 `pageLanguageChecker` 是否覆盖 zh-Hant？

✅ **已覆盖**。PR #65 修改后：
- `getPageDeclaredLanguage()` 使用 `normalizeLanguageTagFull` 保留完整 subtag
- `isPageLanguageSameAsTarget()` 使用 `isSameLanguage()` 比较
- 对 zh-TW 页面 + zh-Hant 目标：`isSameLanguage("zh-tw", "zh-hant")` → 两者都是 Traditional → `true` → 正确抑制浮动按钮
- 对 zh-CN 页面 + zh-Hant 目标：`isSameLanguage("zh-cn", "zh-hant")` → 一简一繁 → `false` → 正确显示浮动按钮

#### 3.4 Custom API (LLM) Provider 的特殊分析

**调用链**:
```
FullTranslateBatchHandler → translateWithCustomApi(data, customProvider)
  → generateModule.generateFullTextBatch(data.texts, data.sourceLang, data.targetLang, llmConfig)
    → FullTextBatchGenerationService.translateBatch()
      → languageUtils.getLanguageNames(sourceLanguage, targetLanguage)
        → getLanguageName("zh-Hant")
          → LANGUAGE_NAMES["zh-Hant"]  // ⚠️ 不存在！
          → 返回原始字符串 "zh-Hant"
      → userPrompt 渲染: "# Target Language\nzh-Hant"
```

**⚠️ 风险点**: `languageUtils.ts` 的 `LANGUAGE_NAMES` 映射表**缺少 `"zh-Hant"` 条目**。当用户使用 Custom API provider 且目标语言为 zh-Hant 时，LLM prompt 中的目标语言名称会显示为原始代码 `"zh-Hant"` 而非可读名称如 `"Traditional Chinese"` 或 `"繁體中文"`。

**影响程度**: **低**。现代 LLM（GPT/Claude/DeepSeek）通常能理解 "zh-Hant" 这个 BCP 47 标签。但缺少人类可读名称理论上可能降低翻译质量的一致性。

**建议修复**: 在 `src/8_generate/utils/languageUtils.ts` 的 `LANGUAGE_NAMES` 中添加：
```typescript
"zh-hant": "Traditional Chinese",
```

---

### 要点 4：遗漏风险

#### 4.1 PR #60 新增的 locales/*.json 是否需要增加 zh-Hant 相关 key？

**不需要**。locales 文件控制的是扩展 UI 界面语言（如中文界面、英文界面），与翻译目标语言无关。用户选择「翻译为繁體中文」后，UI 仍按用户浏览器语言显示。新增的 `<option value="zh-Hant">繁體中文</option>` 是硬编码在 HTML 中的，不需要 i18n key。✅ 无遗漏。

#### 4.2 全文翻译模块的 UI 文案、错误提示是否覆盖繁体中文？

相关文案检查：
- `fullTranslate.quotaExhausted.toast` = "Today's free translation quota has been used up..."
- `fullTranslate.providerFallback.toast` = "TapWord full-page translation quota is used up..."

这些 toast 消息使用用户 UI 语言显示，与翻译目标语言无关。✅ 无遗漏。

#### 4.3 配额兜底提示是否有语言相关的遗漏？

配额检查路径：`FullTranslateHandler.startTranslation()` → `QUOTA_USAGE_REQUEST` → 根据剩余配额显示提示。配额逻辑完全与语言无关。✅ 无遗漏。

#### 4.4 fewshot 示例文件的简繁体匹配

`promptLoader.loadFewshot(taskName, "zh-Hant")`:
```typescript
const normalizedLang = (language?.split("-")[0] || "en").toLowerCase()
// "zh-Hant".split("-")[0] = "zh"
```

加载 `resources/8_generate/full_text_batch/zh/fewshot.json` — ✅ 正确回退到 `zh/` 目录。

**潜在风险**: `zh/fewshot.json` 中的示例输出为简体中文。当目标语言是 zh-Hant 时，LLM 看到的 fewshot 示例是简体输出，可能影响输出一致性。但 system prompt 中明确了目标语言，现代 LLM 可以处理这个差异。**影响程度：极低**。

#### 4.5 TranslationCache 语言隔离

`TranslationCache` 的 key = SHA-256(`text|sourceLang|targetLang`)。`"zh"` 和 `"zh-Hant"` 产生不同的 hash，缓存自动隔离。✅ 无串扰风险。

---

### 要点 5：结论建议

#### 是否需要改动 PR #65 的代码？

**不需要阻塞合并**。PR #65 与 PR #60 整体兼容，所有核心功能路径（全文翻译、选词翻译、浮动按钮、多 Provider）均正确支持 zh-Hant。

#### 建议的低优先级改进（不阻塞合并）

| # | 文件 | 改动 | 优先级 | 理由 |
|---|------|------|--------|------|
| 1 | `src/8_generate/utils/languageUtils.ts` | 在 `LANGUAGE_NAMES` 中添加 `"zh-hant": "Traditional Chinese"` | P3-低 | 提升 Custom API provider 下 LLM prompt 的目标语言名称可读性 |
| 2 | `resources/8_generate/full_text_batch/` | 考虑添加 `zh-Hant/fewshot.json` 繁体示例 | P4-极低 | 提升 LLM 翻译繁体时的 fewshot 一致性；当前 zh/ 示例已通过 split 回退加载，功能正常 |

---

## 四、总结

### 明确结论

**PR #65「繁体中文支持」与 PR #60「全文翻译+多Provider」代码兼容，可以安全合并。**

PR #65 的改动精准地落在 zh-Hant 支持所需的路径上：
- **翻译资格判断**（`translationWalker.ts`）→ 正确区分简繁体
- **语言检测/比较**（`languageTagUtils.ts`、`languageValidator.ts`、`pageLanguageChecker.ts`）→ 正确区分简繁体页面
- **语言显示**（`languageDisplay.ts`、UI HTML）→ 正确显示繁體中文
- **新用户默认语言**（`storageManager.ts`）→ 正确检测繁体中文浏览器

所有翻译 Provider（Official/Microsoft/Google/Bing/MTranServer/CustomAPI）均已有 zh-Hant 的语言码映射或透传支持，无需额外改动。

### 风险清单

| 风险 | 严重性 | 影响 | 处理建议 |
|------|--------|------|----------|
| `languageUtils.ts` 缺少 `"zh-Hant"` 映射 | 🟢 低 | Custom API provider 的 LLM prompt 中目标语言显示为代码而非名称 | 后续小 PR 补充 |
| fewshot 示例为简体中文 | 🟢 极低 | LLM 可能在繁体翻译时参考简体示例 | 后续评估是否需要单独的 zh-Hant fewshot |
| 繁体检测字符集 `TRADITIONAL_ONLY_CHARS` 不完全精确 | 🟢 低 | 含混合简繁体的文本可能误判 | 启发式方法本身的局限性，可接受 |
