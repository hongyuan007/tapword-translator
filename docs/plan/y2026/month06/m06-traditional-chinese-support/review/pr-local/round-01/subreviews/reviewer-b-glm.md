# Code Review Report — Reviewer B (GLM-5.1)

> **PR**: 翻译目标语言支持繁体中文
> **分支**: `feat/260613/traditional-chinese-support`
> **审查日期**: 2026-06-13
> **审查模型**: zai/glm-5.1
> **审查方式**: 逐文件完整读取 + 零信任分析

---

## Findings

### P0

无。

### P1

无。

### P2

#### P2-1：`isTraditionalChinese` / `getMainSubtag` / `isSameLanguage` 在两个文件中完全重复

**文件**: `src/1_content/utils/languageValidator.ts`、`src/1_content/utils/pageLanguageChecker.ts`

`isTraditionalChinese`、`getMainSubtag`、`isSameLanguage` 三个函数在 `languageValidator.ts`（L228-260）和 `pageLanguageChecker.ts`（L74-108）中以几乎完全相同的实现重复存在。此外，两个文件中的归一化函数（`normalizeLanguageTagFull` vs `normalizeLangTag`）逻辑完全相同，仅函数名不同。

这违反了项目规则中明确的编码规范：
> "Reuse existing shared types/utilities instead of duplicating them."

**风险**: 未来修改 `isSameLanguage` 逻辑时可能遗漏其中一处，导致两个路径的抑制行为不一致。

**建议**: 将这些函数抽取到 `src/0_common/utils/` 下的共享模块（如 `languageCompare.ts`），两个文件统一 import。可在本 PR 修复或作为紧随的技术债 issue。

#### P2-2：`pageLanguageChecker.ts` 的 `detectLanguageFromContent()` 仍返回 `'zh'`，无法区分繁简

**文件**: `src/1_content/utils/pageLanguageChecker.ts` L53-69

`detectLanguageFromContent()` 通过脚本采样检测页面语言，对中文内容统一返回 `'zh'`（不含 region/script 子标签）。当页面没有 `<html lang>` 元数据时，此函数是唯一的回退信号。

**场景**: 繁体中文页面（如 `<html lang="zh-TW">` 缺失），目标语言为 `zh-Hant`：
- `detectLanguageFromContent()` 返回 `'zh'`
- `isSameLanguage('zh', 'zh-hant')` → `getMainSubtag` 均为 `'zh'`，但 `isTraditionalChinese('zh')` 为 `false`，`isTraditionalChinese('zh-hant')` 为 `true` → 返回 `false`
- 结论：不抑制翻译 → 繁体页面上仍会显示翻译图标

这是功能缺陷（非回归）—— 在没有元数据的繁体页面上，翻译抑制不生效。但影响范围有限：现代网站普遍设置 `<html lang>`。

**建议**: 考虑在 `detectLanguageFromContent()` 中对检测到的中文内容进一步做 `detectChineseScript` 判断（但需注意该函数目前是 `pageLanguageChecker.ts` 的内部函数，且 `detectChineseScript` 定义在 `languageValidator.ts` 中——又一个重复/耦合问题）。可作为后续优化项。

#### P2-3：未新增 zh-Hant 相关的单元测试

**文件**: `tests/1_content/utils/languageValidator.unit.test.ts`

本 PR 对核心翻译抑制逻辑做了重大修改（`isSameLanguage`、`detectChineseScript`、`normalizeLanguageTagFull`），但测试文件仅修改了一个既有用例（将 `xmlLang: "zh-TW"` 改为 `xmlLang: "zh-CN"` 以适配新逻辑），**未新增任何 zh-Hant 场景的测试**。

方案文档明确列出了应有的测试用例：
- `isSameLanguage` 的各种组合（zh-CN vs zh-Hant、zh-TW vs zh-Hant、zh-Hans vs zh-Hant、zh vs zh-Hant、en vs zh-Hant 等）
- `detectChineseScript` 对繁体/简体文本的判定
- `detectBrowserLanguage` 对 zh-TW/zh-HK 浏览器语言的匹配

缺少这些测试意味着回归保护不足。虽然现有测试通过（验证了既有行为不被破坏），但新功能的正确性未被自动化测试覆盖。

**建议**: 本 PR 应补充以下测试：
1. `shouldTriggerTranslationAsync` 传入 `"zh-Hant"` 目标语言的各种场景
2. 简体文本 + zh-Hant 目标 → 触发翻译（核心修复点）
3. 繁体文本 + zh-Hant 目标 → 抑制翻译
4. 繁体文本 + zh 目标 → 触发翻译
5. 繁体页面元数据（zh-TW）+ zh-Hant 目标 → 抑制翻译

#### P2-4：`detectChineseScript` 的假阴性问题——仅检测特征字符存在性

**文件**: `src/1_content/utils/languageValidator.ts` L268-278

`detectChineseScript` 遍历文本，只要发现一个 `TRADITIONAL_ONLY_CHARS` 中的字符就判定为繁体，否则判定为简体。

**问题**: 许多繁体文本中的部分字符与简体共用（如「你」「好」「世」「界」）。如果选中的短文本恰好不包含任何繁体特征字，就会被误判为简体。

**实际影响场景**: 用户在繁体页面（`zh-TW`）选中「你好世界」，目标语言为 `zh-Hant`：
- `detectChineseScript("你好世界")` → `"simplified"`（这些字简繁通用）
- `textLang = "zh"`
- `isSameLanguage("zh", "zh-hant")` → `false`（简体 ≠ 繁体）
- 翻译不被抑制 → 用户看到不必要的翻译图标

**影响程度**: 低。仅影响短文本选择的 UX（多展示了一个翻译图标），不影响功能正确性。用户不会对「你好世界」翻译为繁体产生困惑。

**反向误判风险**: 无。`TRADITIONAL_ONLY_CHARS` 中的字符只出现在繁体中，不会将简体误判为繁体。

**建议**: 当前启发式对实用场景可接受。未来可考虑增加简体特征字检测（如「这」「个」「们」「时」等）做双向判断，提高短文本准确率。文档中应标注此局限性。

#### P2-5：引入了拼写错误 "coalescling"

**文件**: `src/0_common/utils/storageManager.ts` L250（diff）

```diff
-    // Use optional chaining and nullish coalescing for safe access
+    // Use optional chaining and nullish coalescling for safe access
```

"coalescing" 被错误改为 "coalescling"。

**建议**: 修正拼写。

### P3

#### P3-1：`SUPPORTED_LANGUAGES` 中的 `"zh-Hant"` 是死代码

**文件**: `src/0_common/utils/storageManager.ts` L243

```typescript
const SUPPORTED_LANGUAGES = ["en", "zh", "zh-Hant", "es", "ja", "fr", "de", "ko", "ru"]
```

`SUPPORTED_LANGUAGES` 仅在 `primaryLang` 的 `includes()` 检查中使用。`primaryLang` 来自 `browserLang.split("-")[0]?.toLowerCase()`，永远是主语言子标签（如 `"zh"`、`"en"`），不可能是 `"zh-Hant"`。因此 `"zh-Hant"` 在此数组中永远不会被 `includes()` 匹配到——它是一个无效条目。

实际的繁体中文检测由函数中更早的精确匹配分支完成（L255-258）。此数组条目给人「已有支持」的错觉，实际上不起任何作用。

**建议**: 移除 `"zh-Hant"` 或添加注释说明其为文档性质（表明产品支持该语言）。

#### P3-2：`detectBrowserLanguage` JSDoc 注释过时

**文件**: `src/0_common/utils/storageManager.ts` L236-237

```typescript
/**
 * Detect browser language and map to supported target language
 * Supported languages: zh, en, ja, ko, fr, es, ru
 */
```

注释中缺少 `zh-Hant` 和 `de`。

**建议**: 更新注释。

#### P3-3：`TRADITIONAL_ONLY_CHARS` 内联大常量

**文件**: `src/1_content/utils/languageValidator.ts` L257-259

约 200 个繁体特征字符以内联字符串形式硬编码在函数定义上方。虽然功能上没有问题，但可读性较差。

**建议**: 可考虑抽取为独立的常量文件或数据文件（如 `traditionalChars.ts`），便于维护和扩展。优先级低。

#### P3-4：归一化函数命名不一致

**文件**: `languageValidator.ts` 使用 `normalizeLanguageTagFull`；`pageLanguageChecker.ts` 使用 `normalizeLangTag`。

两者实现完全相同（lowercase + replace `_` with `-`），但命名风格不一致。如果按 P2-1 的建议抽取到共享模块，此问题自然解决。

---

## Open Questions

1. **Official Cloud API 是否支持 `zh-Hant`？** 方案中标注为「不确定」。如果后端不支持，用户选择繁体中文并使用 Official Cloud API 引擎时会收到错误。前端目前不做拦截。建议与后端确认或在前端引擎层增加 fallback 处理。

2. **Custom LLM 引擎的 `split("-")[0]` 未处理。** 方案中提到 `promptLoader.ts` L101 会将 `zh-Hant` 截断为 `zh`，但本 PR 未修改。需求文档明确说「不修改 Custom LLM」——这意味着 LLM 引擎用户选择繁体中文后，实际收到的是「翻译成中文」提示，可能输出简体。这是已知限制还是遗漏？

3. **`languageDetector.ts` 的 `normalizeLangCode()` 未修改（方案中有意为之）。** 经分析确认安全：该函数的输出会被 `isSameLanguage` 正确处理。但建议在代码注释中标注此依赖关系，避免未来修改 `normalizeLangCode` 时引入回归。

4. **i18n locale 文件是否需要更新？** 需求文档的验收标准提到「8 个语言包补充相关 key」。本次 diff 中未包含 locale 文件改动。需确认是否遗漏或经检查后确认无相关 key。

---

## Change Summary

本 PR 为翻译目标语言新增繁体中文（`zh-Hant`）支持。改动涵盖 7 个文件：(1) UI 层在 popup 和 options 的下拉列表添加 `<option value="zh-Hant">繁體中文</option>`；(2) 显示层和存储层新增对应映射和浏览器语言检测；(3) 核心翻译抑制逻辑（`languageValidator.ts` 和 `pageLanguageChecker.ts`）将原有 `split("-")[0]` 一刀切归一化替换为基于 BCP 47 完整标签的智能比较，对中文族（`zh-*`）区分简繁变体，对其他语言保持主子标签比较（等效原行为）；(4) 新增 `detectChineseScript` 启发式函数通过特征字符集检测繁简；(5) 适配了一个既有测试用例。整体架构合理，对现有语言的回归风险低，但存在代码重复、测试覆盖不足、内容采样无法区分繁简等可维护性/功能覆盖问题。

---

## Residual Risks

1. **`detectChineseScript` 的准确率上限**: 基于特征字符的启发式检测在短文本（<10 字符）场景下有较高的假阴性率（将繁体误判为简体），导致翻译图标在繁体页面上不必要显示。不影响功能正确性，仅影响 UX。

2. **`detectLanguageFromContent()` 无法识别繁体页面**: 当页面缺乏 `<html lang>` 等元数据时，内容采样仅返回 `'zh'`，无法区分繁简。这意味着 `<html lang>` 缺失的繁体页面在目标为 `zh-Hant` 时不会被抑制。

3. **新功能缺乏自动化测试覆盖**: `isSameLanguage`、`detectChineseScript`、`detectBrowserLanguage` 的繁体支持逻辑均无对应的单元测试。手动测试可能覆盖了主要场景，但长期回归保护不足。

4. **Custom LLM 引擎不区分繁简**: 用户选择繁体中文但使用 Custom LLM 引擎时，LLM 收到的提示为「翻译成中文」（非「翻译成繁体中文」），可能输出简体。需确认是否为预期行为。

5. **Official Cloud API 后端支持未确认**: 如果后端不支持 `zh-Hant`，用户使用此引擎时会遇到翻译错误。
