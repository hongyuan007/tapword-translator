## Findings

### P0
无。

### P1
1. `[src/1_content/utils/languageValidator.ts:86-109,292-299]` 繁体页面上选中“无繁简差异字”的中文文本时，会绕过页面语言抑制

   `shouldTriggerTranslationAsync()` 在中文目标分支里先根据选中文本做 `detectChineseScript()`，且 `detectChineseScript()` 只要没命中 Traditional-only 字符就直接返回 `"simplified"`。因此在 `<html lang="zh-TW">` / `zh-Hant` 页面上，用户选中常见但无繁简差异的文本（例如 `你好世界`、`中文`、`香港` 中部分短词等）且目标语言为 `zh-Hant` 时，流程会得到 `textLang = "zh"`，`isSameLanguage("zh", "zh-hant") === false`，随后在第 109 行直接 `return true`，不会再执行第 112-120 行的页面语言抑制判断。

   这会破坏需求中的核心场景“繁体中文网页 + 目标语言 zh-Hant 时应抑制翻译”。建议不要把“未命中繁体专属字”直接等价为简体：可让 `detectChineseScript()` 返回 `unknown`，在 `unknown` 时继续参考 `pageDeclaredLanguage` / context；或在中文文本分支中，当页面声明语言与目标一致时优先抑制。需要补一个回归用例：`htmlLang: "zh-TW"` + `text: "你好世界"` + `target: "zh-Hant"` 应返回 `false`。

### P2
1. `[src/1_content/utils/pageLanguageChecker.ts:64-69,134-139]` 无 metadata 的繁体页面无法通过内容采样抑制浮动按钮

   `detectLanguageFromContent()` 对所有“有足够 Han 字符且无 Kana”的页面都返回裸 `"zh"`，没有像 `languageValidator.ts` 一样区分简繁。对没有设置 `<html lang>` / `og:locale` 的繁体页面，目标语言为 `zh-Hant` 时会走到 `isSameLanguage("zh", "zh-hant") === false`，于是 `FloatingButtonIntegration` 会继续显示全页翻译浮动按钮。该路径与本次新增 zh-Hant 的抑制目标不一致。

   建议复用同一套中文脚本判断逻辑：内容采样若能判定为繁体则返回 `zh-Hant`，判定为简体则返回 `zh`；无法判定时再按保守策略处理。最好为 `isPageLanguageSameAsTarget("zh-Hant")` 增加繁体正文、无 metadata 的测试。

2. `[src/0_common/utils/storageManager.ts:250-255]` `detectBrowserLanguage()` 漏掉澳门和带 script+region 的繁体浏览器标签

   需求背景明确覆盖台湾、香港、澳门用户，且 `isTraditionalChinese()` 已把 `mo` 作为繁体地区处理；但新用户默认语言检测只精确匹配 `zh-tw` / `zh-hk` / `zh-hant`。`zh-MO`、`zh-Hant-MO`、`zh-Hant-TW`、`zh-Hant-HK` 等合法/常见 BCP 47 变体都会落回 `split("-")[0]`，最终默认成简体 `zh`。这会让部分繁体用户首次安装体验不符合预期。

   建议改为解析 subtags：只要主语言是 `zh` 且 script 为 `Hant`，或 region 属于 `TW/HK/MO`，就返回 `zh-Hant`；并补充 `zh-MO` / `zh-Hant-TW` 测试。

### P3
1. `[src/1_content/utils/languageValidator.ts:237-273, src/1_content/utils/pageLanguageChecker.ts:77-110]` 语言标签比较逻辑重复，已出现行为分叉风险

   `isTraditionalChinese` / `getMainSubtag` / `isSameLanguage` 在两个 content util 中重复实现，且 `pageLanguageChecker` 没有同步 `languageValidator` 的文本脚本判断能力。这类逻辑是本功能的核心判定规则，继续复制会让后续新增语言变体或修 bug 时很容易漏改一处。

   建议抽成一个纯工具模块（例如 `src/0_common/utils/languageTagUtils.ts` 或 content 内共享 util），两个调用方统一复用，并围绕该模块写直接单元测试。

## Open Questions

- 本轮按任务指定的 7 个文件审查；工作区中另有未跟踪测试文件（如 traditional-chinese 相关测试）未包含在“7 个文件变更”清单内，最终合并范围需要确认。
- Official Cloud API / Custom LLM 对 `zh-Hant` 的支持在需求中标为风险/不包含，本轮未审查引擎层实现。

## Change Summary

本次变更在 popup/options 增加 `zh-Hant` 选项，在显示与新用户语言检测中加入繁体中文，并重写 content 侧语言比较逻辑以避免把所有 `zh-*` 都截断成 `zh`；整体方向符合方案 B，但中文脚本启发式与页面语言信号的组合仍有可复现的抑制漏判。

## Residual Risks

- `detectChineseScript()` 的 Traditional-only 字符集启发式不可能覆盖所有短文本，尤其是繁简同形词；如果没有 `unknown` 状态或页面/context 兜底，zh-Hant 抑制会持续存在误判。
- `pageLanguageChecker` 缺少针对 `zh-Hant` 的直接测试，浮动按钮路径与划词路径可能继续分叉。
- 未运行构建/测试；本报告基于静态审查。