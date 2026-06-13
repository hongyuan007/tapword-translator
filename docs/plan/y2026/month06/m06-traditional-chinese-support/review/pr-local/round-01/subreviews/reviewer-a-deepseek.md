# Reviewer A — Code Review Report（DeepSeek V4 Pro）

> **审查 PR**: feat/260613/traditional-chinese-support
> **审查范围**: 7 个文件变更
> **审查日期**: 2026-06-13
> **审查模型**: deepseek/deepseek-v4-pro（thinking=max）

---

## Findings

### P0

（无 P0 级别问题）

---

### P1

#### P1-1：`translationWalker.ts` 中 `zh-Hant` 截断未修复（全页翻译路径遗漏）

- **文件**: `src/11_full_translate/dom/translationWalker.ts:135`
- **现状**: `shouldSkipChineseTargetLanguageText()` 中仍使用 `split(/[-_]/)[0]` 归一化 targetLanguage，`zh-Hant` 被截断为 `zh`
- **影响**: 用户在简体中文页面使用全页翻译（目标 `zh-Hant`）时，`shouldSkipChineseTargetLanguageText` 会将所有中文块视为「已是目标语言」而跳过，导致全页翻译功能对繁体中文目标**完全失效**
- **证据**: 
  ```typescript
  // 当前代码（未修改）
  const normalizedTarget = (targetLanguage || '').toLowerCase().split(/[-_]/)[0] ?? '';
  if (normalizedTarget !== CHINESE_TARGET_LANG) return false; // zh-Hant → zh → 等于 CHINESE_TARGET_LANG → 进入跳过逻辑
  ```
- **修复建议**: 同步引入 `isTraditionalChinese` / `isSameLanguage` 或至少将 `zh-Hant` 也纳入 `CHINESE_TARGET_LANG` 的比较范围，避免误跳过。简繁页面相互转换时应始终触发翻译
- **严重性**: P1 — 全页翻译路径功能回归，合并前必须修复

#### P1-2：繁体中文场景缺少单元测试覆盖

- **文件**: `tests/1_content/utils/languageValidator.unit.test.ts`
- **现状**: 测试文件只有 1 处适配性修改（`xml:lang` 测试从 `zh-TW` 改为 `zh-CN`），零新增测试用例
- **技术方案中列出的测试场景全部未实现**:
  - `isSameLanguage("zh-CN", "zh-Hant") → false`（简体页面不应抑制繁体翻译）
  - `isSameLanguage("zh-TW", "zh-Hant") → true`（繁体页面应抑制繁体翻译）
  - `isSameLanguage("zh", "zh-Hant") → false`（无 region 的 zh 视为简体）
  - `detectBrowserLanguage("zh-TW") → "zh-Hant"`
  - `detectBrowserLanguage("zh-HK") → "zh-Hant"`
  - `shouldTriggerTranslationAsync("你好世界", "zh-Hant") → true`（简体文本 + 繁体目标 → 触发翻译）
  - 等
- **风险**: 
  - `isTraditionalChinese` 的 `includes("tw")` 在目标语言为 `"zhtw"`（无连字符）时应正确返回 true（当前 `includes` 实现可以匹配）
  - `getMainSubtag` 在输入为 `""` 时的行为已用 `?.` 和 `??` 保护，但未显式测试
  - `detectChineseScript` 的字符集准确性无法通过测试验证
  - 未来重构 `isSameLanguage` 等函数时缺少保障
- **修复建议**: 按方案中的测试计划新增至少 10 个测试用例，覆盖所有新增函数的边界条件
- **严重性**: P1 — 核心路径改动缺少测试保障，合并前必须补充

---

### P2

#### P2-1：`isSameLanguage` / `isTraditionalChinese` / `getMainSubtag` 在 `languageValidator.ts` 和 `pageLanguageChecker.ts` 之间重复

- **影响范围**: 
  - `languageValidator.ts` L230-280：`isSameLanguage`, `isTraditionalChinese`, `getMainSubtag`
  - `pageLanguageChecker.ts` L74-107：相同的三个函数（实现完全相同，仅引号风格差异）
- **问题**: 两份逻辑必须同步维护。如果将来需要支持其他带子标签的语言（如 `pt-BR` vs `pt-PT`），两处都需修改
- **修复建议**: 将 `isSameLanguage`、`isTraditionalChinese`、`getMainSubtag`、`normalizeLanguageTagFull` 提取到 `src/1_content/utils/` 下的共享模块（如 `languageTagUtils.ts`），由两个消费方分别导入。注意：`pageLanguageChecker.ts` 的 `normalizeLocaleMeta` 与 `languageValidator.ts` 的实现有微妙差异（一个用 `replace(/_/g, '-')`，一个也如此——实际上两者已经一致，提取后消除这个隐患）
- **严重性**: P2 — 中等可维护性风险，建议本 PR 处理

#### P2-2：`detectChineseScript` 字符集覆盖度不足

- **文件**: `languageValidator.ts` L286-291
- **现状**: `TRADITIONAL_ONLY_CHARS` 包含约 280 个字符，但存在较明显的漏字：
  - 缺「門」（门）、「開」（开）、「關」（关）、「長」（长）、「馬」（马）、「沒」（没）、「見」（见）、「說」（说）、「語」（语）、「問」（问）、「間」（间）、「聞」（闻）、「閒」（闲）等大量常用繁体字
  - 实际生产中，简繁转换对照表通常有 **2000-3000+** 个字符对（如 OpenCC 的标准词典）
- **影响分析**: 
  - **假阴性（繁体文本被误判为简体）**: 如果用户选中一组只含共享字符的繁体文本，`detectChineseScript` 返回 `"simplified"`。此时 `textLang = "zh"`（视为简体），与 `tgtLang = "zh-Hant"` 比较 → `isSameLanguage` 返回 `false` → **翻译仍然触发**。**行为正确，无功能缺陷**。
  - **假阳性（简体文本被误判为繁体）**: 如果简体文本中偶然包含某个也在 `TRADITIONAL_ONLY_CHARS` 中的字符（几乎不可能——这些确实都是繁体专属字符），则会导致错误抑制。**风险极低**。
- **结论**: 当前实现是 **安全但有损的**——不会造成错误的翻译抑制（不会漏掉需要的翻译），但可能对明显是繁体的文本错过抑制机会（无需翻译时仍显示图标）。建议在 PR 描述中标注字符集为启发式实现、非穷举，后续可迭代补充
- **严重性**: P2 — 有用户可感知的行为（不必要的翻译图标显示），但不影响功能正确性

#### P2-3：`detectLanguageFromContent` 无法区分简繁，导致无 lang 元数据的繁体页面显示不必要的浮动按钮

- **文件**: `pageLanguageChecker.ts` L49-67
- **现状**: `detectLanguageFromContent` 对所有 Han-dominant 页面统一返回 `"zh"`，不区分简繁
- **影响**: 
  - 无 `<html lang>` 属性的繁体中文页面 + 用户目标 `zh-Hant` → `detectLanguageFromContent` 返回 `"zh"` → `isSameLanguage("zh", "zh-Hant")` → main="zh" 同为 true，但传统判定一个 false 一个 true → 不匹配 → **浮动翻译按钮仍会显示**
  - 虽然不会错误地抑制翻译（安全），但会给用户呈现一个无意义的浮动按钮
- **修复建议**: 可考虑在 `detectLanguageFromContent` 中也加入简繁检测（对 Han-dominant body text 调用 `detectChineseScript` 或类似逻辑），使返回值为 `"zh"` 或 `"zh-Hant"`
- **严重性**: P2 — 次要 UX 问题，非阻塞

#### P2-4：`languageValidator.ts` 中 default 分支的 `detectedLang === tgtMain` 比较存在语义不一致

- **文件**: `languageValidator.ts` L190-195
- **现状**: 
  ```typescript
  const { lang: detectedLang } = await detectSourceLanguageAsync(contextText)
  if (detectedLang === tgtMain) {
  ```
  - `detectedLang` 来自 `detectSourceLanguageAsync` → `normalizeLangCode`，始终是主标签（如 `"es"`, `"fr"`）
  - `tgtMain` = `getMainSubtag(tgtLang)`，对于 `"zh-Hant"` 就是 `"zh"`
  - **但** default 分支不会命中 `"zh-Hant"`（因为 `getMainSubtag("zh-Hant") === "zh"`，已经被 `case "zh":` 捕获）
- **结论**: 当前行为对现有语言 **完全兼容**（等于原来的 `split("-")[0]` 比较），无回归；`zh-Hant` 不会走到这个分支。**无实际 bug**
- **建议**: 可在注释中明确说明此处的语义等价性，避免后续维护时产生歧义
- **严重性**: P2 — 低风险的语义不一致，建议加注释澄清

---

### P3

#### P3-1：`storageManager.ts` 中的拼写错误（pre-existing）

- **文件**: `storageManager.ts` L247
- **现状**: 注释 "nullish coalescling" 应为 "nullish coalescing"
- **严重性**: P3 — 次要拼写，不影响功能

#### P3-2：Custom LLM 路径的 `zh-Hant` 截断（已知局限性）

- **文件**: `src/8_generate/utils/promptLoader.ts` L102
- **现状**: `language?.split("-")[0]` 会将 `zh-Hant` 截断为 `zh`，LLM 收到的提示是「翻译成中文」而非「翻译成繁体中文」
- **处理**: 技术方案中明确标注为**本次不改动**（"不修改 Custom LLM 引擎的繁简区分逻辑"），这是已知的局限性
- **建议**: 创建 follow-up issue 跟踪，或在产品文档中标注 Custom LLM 引擎的繁体支持为「部分就绪」（有后端能力但前端未透传正确的语言代码）
- **严重性**: P3 — 已知局限性，有文档说明

#### P3-3：`detectChineseScript` 对空文本返回值 `"unknown"` 时的默认处理缺少注释

- **文件**: `languageValidator.ts` L94
- **现状**: 
  ```typescript
  const textScript = detectChineseScript(text)
  const textLang = textScript === "traditional" ? "zh-Hant" : "zh"
  ```
  当 `textScript === "unknown"` 时，走到 `: "zh"` 分支。行为是正确的（空文本不应抑制翻译），但意图不显式
- **建议**: 添加注释说明当检测结果为 `"unknown"` 时默认视为简体（不应抑制翻译）
- **严重性**: P3 — 代码可读性改进

#### P3-4：HTML option 标签的 `value="zh-Hant"` 未序列化/反序列化验证

- **文件**: `src/3_popup/index.html:116`、`src/4_options/index.html:71`
- **现状**: option 值直接写为 `value="zh-Hant"`，未在 JS 层做值有效性校验。若将来从 HTML 渲染方式改为 JS 动态生成，有可能出现值与 storage 不一致的风险
- **当前评估**: 现有架构中 `targetLanguage` 通过 `data-setting` 属性绑定存储层读取，校验链在 `storageManager.ts` 中。`zh-Hant` 已添加到 `SUPPORTED_LANGUAGES`，校验路径畅通
- **严重性**: P3 — 低风险，但可作为后续架构改进（统一语言数据源）的提示

---

## Open Questions

1. **`detectChineseScript` 字符集完整度** — 现有 ~280 个字符已覆盖最常见歧义字，但是否有正式来源（如 Unicode Unihan 数据库的 kSimplifiedVariant 字段？）可用来生成更完整的列表？建议在 PR 描述或注释中标注字符集来源与选取标准。

2. **`zh` vs `zh-Hans`** — 当用户目标语言为 `zh` 时，BZP 47 标准中 `zh` 等于 `zh-Hans`（默认为简体中文）。但 `isTraditionalChinese("zh")` 返回 `false`（正确）。如果将来引入 `zh-Hans` 作为显式选项，需要确保 `isTraditionalChinese("zh-Hans")` 也返回 `false`（当前 `includes("hans")` 不匹配，`includes("tw/hk/mo")` 也不匹配 → 返回 `false`，正确 ✅）。

3. **`navigator.languages` 回退逻辑** — `detectBrowserLanguage` 新增了 `navigator.languages?.[0]` 作为 `navigator.language` 的 fallback。繁体匹配逻辑在 `split` 之前执行，但对于 `navigator.languages = ["zh-TW", "en"]`，如果 `navigator.language` 为空，当前的 `navigator.languages[0]` 能正确取到 `"zh-TW"` 并匹配。✅ 但如果没有 `navigator.language` **且** `navigator.languages` 也为空，则回退到 `"en"`——这是否合理？取决于产品预期。

4. **i18n locale 文件** — 技术方案中提到需检查 8 个 locale 文件，确认是否有与目标语言名称相关的 i18n key。本次 diff 中未包含 locale 文件变更。现有 HTML 中的语言选项名称（如 "English", "中文", "繁體中文"）是直接硬编码的——这符合现有模式。**不需要改动**。

---

## Change Summary

本 PR 实现了翻译目标语言支持繁体中文（`zh-Hant`）的核心功能，采用方案 B（完整方案），修改了 UI 层（popup/options HTML）、存储层（`storageManager.ts`）、显示层（`languageDisplay.ts`）和翻译抑制逻辑（`languageValidator.ts`/`pageLanguageChecker.ts`）。核心设计在于将语言标签归一化从「截断至主标签」升级为「保留完整 BCP 47 标签 + 简繁智能比较」。整体架构合理：通过 `isSameLanguage` 将中文族的简繁区分封装为独立逻辑，非中文族保持原有主标签比较行为；`detectChineseScript` 使用启发式字符集检测文本的简繁属性。回归路径对 `ja/ko/ru/en` 及其他拉丁语系语言完全兼容。

**但有 1 个遗漏点**：全页翻译模块（`translationWalker.ts`）的 `shouldSkipChineseTargetLanguageText` 仍使用旧的 `split` 截断逻辑，导致 `zh-Hant` 在全页翻译路径中失效。此外，繁体中文场景的单元测试完全缺失，核心函数变更缺乏自动化验证保障。

---

## Residual Risks

| # | 风险 | 影响范围 | 缓解建议 |
|---|------|----------|----------|
| 1 | **全页翻译路径 `zh-Hant` 截断**（P1-1） | `11_full_translate` 用户选繁体目标时全页翻译功能失效 | 本 PR 必须同步修复 `translationWalker.ts:135` |
| 2 | **测试覆盖缺失**（P1-2） | 新增函数的回归保障为零，未来重构风险高 | 补充 10+ 单元测试（isSameLanguage / detectChineseScript / detectBrowserLanguage / shouldTriggerTranslationAsync zh-Hant 场景） |
| 3 | **`detectChineseScript` 字符集覆盖** | 繁体文本被误判为简体时不会导致翻译被错误抑制（安全），但可能漏掉抑制机会（不必要的图标显示） | 标注字符集为启发式，后续迭代补充完整映射表 |
| 4 | **代码重复**（P2-1） | `languageValidator.ts` 和 `pageLanguageChecker.ts` 中 `isSameLanguage` 等函数重复，未来修改需同步两处 | 提取到 `1_content/utils/languageTagUtils.ts` |
| 5 | **Content sampling 不区分简繁**（P2-3） | 无 lang 属性的繁体页面会显示不必要的浮动按钮 | 在 `detectLanguageFromContent` 中加入简繁检测 |
| 6 | **Custom LLM 不支持 zh-Hant 透传** | LLM 引擎用户选繁体中文时，后端收到的是 `zh` 而非 `zh-Hant` | 已知局限性，创建 follow-up issue |
| 7 | **浏览器兼容性** | `Intl.DisplayNames.of()` 在旧版浏览器可能不支持（已有 try-catch 回退到 `LANGUAGE_NAME_MAP`），`zh-Hant` 已添加到 MAP | ✅ 回退链路已覆盖 |
| 8 | **`resolveTargetLanguage` 中的简繁比较** | 当前使用原始字符串比较（不做 split），`sourceLanguage = "zh"` ≠ `targetLanguage = "zh-Hant"` → 不触发回退 → 行为正确 ✅ | 无需修改 |
