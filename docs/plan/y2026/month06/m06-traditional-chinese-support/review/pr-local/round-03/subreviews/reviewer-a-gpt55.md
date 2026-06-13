## Round 02 P1 修复验证

### P1-1 验证结果

**结论：通过。**

- `languageValidator.ts` 的 zh case 中，`pageDeclaredLanguage` 检查已移动到文本 Han 比例和 `detectChineseScript()` 分析之前（`src/1_content/utils/languageValidator.ts:84-93`）。
- 繁体页面 `pageDeclaredLanguage="zh-tw"` + 选中「你好世界」+ 目标 `zh-Hant`：`isSameLanguage("zh-tw", "zh-hant")` 会按繁体变体匹配，提前返回 `false`，可抑制翻译。
- 回归：简体页面 `zh-CN` + 目标 `zh` 仍会按简体变体匹配并抑制；纯简体文本 + `zh` 也仍通过文本分析抑制。

### P1-2 验证结果

**结论：部分通过，但修复不完整，见 New Findings / P1。**

已完成部分：
- 已新增 `src/0_common/utils/languageTagUtils.ts`，包含 `normalizeLanguageTagFull`、`normalizeLocaleMeta`、`isTraditionalChinese`、`getMainSubtag`、`isSameLanguage`。
- `languageValidator.ts` 与 `pageLanguageChecker.ts` 都已从共享模块 import。
- 共享模块位于 `0_common` 且自身无项目内 import；`languageValidator/pageLanguageChecker -> 0_common` 方向符合层级，没有发现循环依赖。

未完成部分：
- 两处 `getPageDeclaredLanguage()` 的 `ogLocale === contentLanguage` 一致性检查仍是 no-op：当两个 meta 同时存在但值不一致时，代码仍会 fall through 到 `return ogLocale || contentLanguage || ""` / `return ogLocale || contentLanguage || ''`，继续采纳冲突的弱 metadata。该行为与 `pageLanguageChecker.ts` 注释“only accept meta tags if they agree”以及本轮 P1-2 修复目标不一致。

### P1-3 验证结果

**结论：通过。**

- `translationWalker.ts` 的 `shouldSkipChineseTargetLanguageText()` 保留 `zh*` 目标入口，但新增 `isTraditionalTarget` 分支（`src/11_full_translate/dom/translationWalker.ts:146-164`）。
- `zh-Hant` 目标时不再无条件跳过所有中文文本，只在 `checkHasTraditionalChars()` 命中繁体特征字时跳过。
- 简体文本 + `zh-Hant`：无繁体特征字，返回 `false`，不会跳过，仍会进入翻译。
- 繁体文本 + `zh-Hant`：命中繁体特征字，返回 `true`，跳过。
- plain `zh` 目标仍走原 Han/Latin ratio 行为，未发现行为回归。

## New Findings

### P0

无。

### P1

1. `[src/1_content/utils/pageLanguageChecker.ts:46-51]` / `[src/1_content/utils/languageValidator.ts:37-41]` `og:locale` 与 `content-language` 冲突时仍会采纳其中一个弱 metadata

当前代码只在两者相等时提前 `return`，但不相等时仍执行 `return ogLocale || contentLanguage || ""`。因此页面没有 `html lang/xml:lang`、但存在冲突 meta（例如 `og:locale=zh_TW`、`content-language=en`）时，`pageLanguageChecker` 会直接把页面判为繁体中文并隐藏浮动按钮；`languageValidator` 也可能对英文选择提前抑制翻译。P1-2 明确要求加入 `ogLocale===contentLanguage` 一致性检查，当前实现没有真正阻止冲突 metadata 造成误判。

建议改为：当两者同时存在时，仅在相等时返回；不相等时返回空串并继续走内容检测/异步检测。例如：

```ts
if (ogLocale && contentLanguage) {
    return ogLocale === contentLanguage ? ogLocale : ""
}
return ogLocale || contentLanguage || ""
```

### P2

1. `[src/0_common/utils/storageManager.ts:258-262]` 新用户浏览器语言检测仍漏掉合法繁体标签

当前只精确匹配 `zh-tw`、`zh-hk`、`zh-hant`，但常见/合法 BCP 47 标签如 `zh-Hant-TW`、`zh-Hant-HK`、`zh-MO` 仍会走 primary subtag fallback，最终默认成 `zh`。这会让部分繁体用户首次安装时默认目标语言仍是简体中文。建议复用 `normalizeLanguageTagFull/isTraditionalChinese`，在 primary subtag 为 `zh` 时先判断是否繁体变体。

### P3

1. `[src/1_content/utils/languageValidator.ts:9-14]` / `[src/1_content/utils/pageLanguageChecker.ts:8-12]` 新增工具函数使用 named imports，与项目规则“functions/variables prefer namespace imports”不完全一致。建议改为 `import * as languageTagUtils from "@/0_common/utils/languageTagUtils"` 后通过命名空间调用。

2. `[src/11_full_translate/dom/translationWalker.ts:176-183]` 繁体特征字集合与 `languageValidator.ts` 中集合重复。当前不是功能阻塞，但后续扩充字符集时容易再次分叉；可考虑在共享模块中暴露 `hasTraditionalChineseIndicator()` 或共享常量。

## Overall Verdict

CHANGES_REQUESTED

## Residual Risks

- 未运行测试；本轮为静态审查。
- `detectChineseScript()` / `checkHasTraditionalChars()` 仍是启发式，不覆盖所有繁体字；假阴性会导致不必要翻译，但目前不会导致错误抑制。
- `pageLanguageChecker.detectLanguageFromContent()` 仍只能检测为 plain `zh`，无 metadata 的繁体页面 + `zh-Hant` 目标仍可能显示浮动按钮；这是既有 P2 风险，未在本轮 P1 修复范围内完全解决。
