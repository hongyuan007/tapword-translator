# PR #65 繁体中文支持 × PR #60 全文翻译/多Provider 兼容性调研 — 技术方案

## 现状分析

PR #65（分支 `feat/260613/traditional-chinese-support`）在 PR #60（全文翻译 + 多 Provider 引擎管理）合入 main 后 rebase。PR #65 改动了 8 个源码文件 + 3 个测试文件，其中 `translationWalker.ts` 与 PR #60 的全文翻译模块有直接调用关系。

### PR #65 改动文件清单

| 文件 | 改动 |
|------|------|
| `src/0_common/utils/languageDisplay.ts` | 添加 `"zh-hant": "繁體中文"` 显示映射 |
| `src/0_common/utils/languageTagUtils.ts` | **新增** BCP 47 语言标签工具（区分简繁体） |
| `src/0_common/utils/storageManager.ts` | 浏览器语言检测增加 zh-Hant 精确匹配 |
| `src/11_full_translate/dom/translationWalker.ts` | 跳过逻辑增加 zh-Hant 分支 |
| `src/1_content/utils/languageValidator.ts` | 重构 zh 分支，区分简繁体 |
| `src/1_content/utils/pageLanguageChecker.ts` | 迁移到完整 subtag 比较 |
| `src/3_popup/index.html` | 添加繁體中文选项 |
| `src/4_options/index.html` | 添加繁體中文选项 |

### PR #60 相关模块

`PageTranslationManager.ts`、`FullTranslateHandler.ts`、`BatchQueue.ts`、`FullTranslateBatchHandler.ts`、各 Provider Service、`languageUtils.ts`、`TranslationCache.ts`

## 方案对比

### 方案 A：直接合并 PR #65（推荐）

| 优点 | 缺点 |
|------|------|
| 核心功能路径全部兼容，无阻塞性问题 | Custom API provider 的 LLM prompt 中目标语言显示为代码 `"zh-Hant"` 而非可读名称 |
| 所有 Provider 已有 zh-Hant 语言码映射 | fewshot 示例为简体中文，理论上影响繁体翻译一致性 |
| 不需要额外改动，合并后立即可用 | — |

### 方案 B：合并前先补充 languageUtils 映射

| 优点 | 缺点 |
|------|------|
| 消除 Custom API 场景的低风险点 | 延迟合并，改动范围虽小但需额外 review |
| LLM prompt 完整性更好 | 该问题影响极低（现代 LLM 能理解 BCP 47 标签） |

## 选定方案

**方案 A：直接合并 PR #65。** 2 个低风险改进建议（P3/P4 级）不阻塞合并，可在后续小 PR 处理。

## 调研结论

### 5 个调研要点总结

| # | 要点 | 结论 |
|---|------|------|
| 1 | 代码交叉分析 | ✅ `translationWalker.ts` 被 `PageTranslationManager` 正确调用，zh-Hant 分支无断点 |
| 2 | 功能兼容性 | ✅ zh-Hant 从 UI → storage → config → BatchQueue → Background → Provider 全链路透传 |
| 3 | 多 Provider 场景 | ✅ 4 个 Provider 均有 zh-Hant 映射；languageValidator 和 pageLanguageChecker 通过 isSameLanguage 正确区分简繁 |
| 4 | 遗漏风险 | ✅ locales 无需改动；配额逻辑与语言无关；缓存自动隔离。⚠️ languageUtils.ts 缺 zh-Hant 映射（低风险） |
| 5 | 结论建议 | **不需要改动 PR #65 代码，可以安全合并** |

### 风险清单（不阻塞合并）

| 风险 | 严重性 | 处理建议 |
|------|--------|----------|
| `languageUtils.ts` LANGUAGE_NAMES 缺 `"zh-Hant"` | 🟢 P3-低 | 后续小 PR 添加 `"zh-hant": "Traditional Chinese"` |
| fewshot 示例为简体中文 | 🟢 P4-极低 | 后续评估是否需要 zh-Hant/ 繁体示例 |

## 验证计划

合并后建议人工验证：
1. 设置目标语言为繁體中文，执行全文翻译，确认翻译结果为繁体
2. 分别使用 Official / Microsoft / Google Provider 验证
3. 在繁体中文页面上确认浮动按钮正确抑制
4. 在简体中文页面上确认浮动按钮正确显示

## 关联文档

- 调研报告：`research-report.md`
- 需求文档：`requirement.md`
