# Reviewer B (DeepSeek V4 Pro) — Code Review 报告

> **审查范围**：`feat/260613/traditional-chinese-support` 分支 7 个文件变更
> **审查日期**：2026-06-13
> **审查人**：Reviewer B — DeepSeek V4 Pro（深度思考模式）

---

## 审查总览

| 严重性 | 数量 | 说明 |
|--------|------|------|
| P0 | 0 | 无安全问题 / 数据丢失 |
| P1 | 3 | 功能回归风险 + 架构维护风险 |
| P2 | 3 | 中等正确性 / 可维护性问题 |
| P3 | 4 | 次要改进建议 |

---

## Findings

### P1 — 高置信度功能回归 / 架构风险

#### P1-1: `translationWalker.ts` 的 `split` 截断导致全页翻译的 Simplified→Traditional 失效

- **文件**：`src/11_full_translate/dom/translationWalker.ts`
- **位置**：L131，`shouldSkipChineseTargetLanguageText()` 函数
- **代码**：
  ```typescript
  const normalizedTarget = (targetLanguage || '').toLowerCase().split(/[-_]/)[0] ?? '';
  if (normalizedTarget !== CHINESE_TARGET_LANG) return false; // CHINESE_TARGET_LANG = 'zh'
  ```
- **问题**：当 `targetLanguage = "zh-Hant"` 时，`split(/[-_]/)[0]` 结果为 `"zh"`，匹配 `CHINESE_TARGET_LANG`，函数进入跳过逻辑。这导致**在全页翻译（full-page translate）场景下，用户从简体中文页面使用繁体中文为目标时，已经是中文的文本块会被错误跳过，不会执行简体→繁体的翻译**。
- **影响**：全页翻译功能对 `zh-Hant` 目标语言部分失效。划词翻译不受影响（走的是 `languageValidator.ts` 路径，该文件已正确修复）。
- **建议**：在 `shouldSkipChineseTargetLanguageText` 中，当 `targetLanguage` 为 `zh-Hant` 且页面文本为简体中文时，不应该跳过。可采用与 `isSameLanguage` 一致的中文变体检测逻辑（即检测原文和目标的简繁属性，异化时不跳过）。
- **注意**：该文件不在本次 PR 的 7 个变更文件范围内，但确实是本 Feature 的直接影响对象。

#### P1-2: `languageValidator.ts` 与 `pageLanguageChecker.ts` 之间严重代码重复

以下函数在两文件中**完全相同地复制**，没有任何抽象：

| 函数 | languageValidator.ts | pageLanguageChecker.ts |
|------|---------------------|----------------------|
| `getPageDeclaredLanguage()` | L16-31 | L61-69（逻辑有细微差异，见下文） |
| `normalizeLanguageTagFull` / `normalizeLangTag` | L171-174 | L93-96 |
| `normalizeLocaleMeta()` | L176-183 | L102-107 |
| `isSameLanguage()` | L198-214 | L61-78 |
| `isTraditionalChinese()` | L188-191 | L71-75 |
| `getMainSubtag()` | L194-196 | L78-83 |
| `REGEX_HAN`/`REGEX_KANA`/`REGEX_HANGUL`/`REGEX_CYRILLIC` | L35-38 | L13-16 |

- **风险**：未来任一处的 `isSameLanguage` 逻辑变更（例如需要支持 `zh-MO` 或 `zh-SG`），必须在两个文件中同步修改。遗忘同步将导致划词翻译和浮动按钮抑制行为不一致，产生难以排查的 Bug。
- **建议**：将上述共享函数提取到 `src/0_common/utils/languageUtils.ts`或 `src/1_content/utils/languageUtils.ts`，两文件从共享模块导入。

#### P1-3: `getPageDeclaredLanguage()` 两版本存在逻辑差异

- **`languageValidator.ts` 版本**（L16-31）：
  ```typescript
  const ogLocale = normalizeLocaleMeta(...)
  const contentLanguage = normalizeLocaleMeta(...)
  // 当 ogLocale 和 contentLanguage 都存在且相同时，返回 ogLocale
  if (ogLocale && contentLanguage && ogLocale === contentLanguage) return ogLocale
  return ogLocale || contentLanguage || ""
  ```

- **`pageLanguageChecker.ts` 版本**（L61-69）：
  ```typescript
  const ogLocale = normalizeLocaleMeta(...)
  const contentLanguage = normalizeLocaleMeta(...)
  // 直接短路返回，不检查一致性
  return ogLocale || contentLanguage || ''
  ```

- **差异**：`languageValidator.ts` 版本在 ogLocale 和 contentLanguage 都非空时会验证它们是否一致，不一致时才做 `||` 回退。而 `pageLanguageChecker.ts` 直接使用 `||` 短路，ogLocale 存在时直接返回，**完全忽略 contentLanguage**。这导致相同的 HTML 页面可能在划词翻译抑制和浮动按钮抑制中得出不同结论。

- **建议**：统一逻辑并提取共享。推荐采用 `languageValidator.ts` 的版本（更严谨，两个 meta 标签一致时才采纳）。

---

### P2 — 中等正确性 / 可维护性问题

#### P2-1: `detectChineseScript` 繁体字集不完整

- **文件**：`src/1_content/utils/languageValidator.ts`，L223-226
- **问题**：`TRADITIONAL_ONLY_CHARS` 包含约 200 个字符，但实际上繁简体不共享的字符数量远超此数。以下常见繁体字不在集合中，导致含有这些字的文本被错误归类为 `"simplified"`：

  | 繁体 | 简体 | 是否在集合中 |
  |------|------|-------------|
  | 測 | 测 | ❌ |
  | 試 | 试 | ❌ |
  | 練 | 练 | ❌ |
  | 體 | 体 | ❌ |
  | 處 | 处 | ❌ |
  | 變 | 变 | ❌ |
  | 關 | 关 | ❌ |
  | 讓 | 让 | ❌ |
  | 寫 | 写 | ❌ |
  | 實 | 实 | ❌ |
  | 際 | 际 | ❌ |
  | 還 | 还 | ❌ |
  | 組 | 组 | ❌ |

- **影响**：含上述字符的繁体文本会被判定为简体，从而导致以下错误行为：
  - **用户场景**：用户浏览繁体页面，目标语言为 `zh-Hant`，划词选中「測試」→ `detectChineseScript` 判定为 `"simplified"` → `isSameLanguage("zh", "zh-Hant")` → `false` → **错误触发翻译**
  - 这是 **false positive 场景**（不应翻译的繁体文本被翻译），影响相对较小——用户会看到不必要的翻译图标，但不会阻止功能。
- **严重性降级理由**：即使误判，翻译引擎大概率仍会将繁体原文翻译为繁体结果（零改动翻译），对用户的实际影响有限。且 `getPageDeclaredLanguage()` 信号（如 `<html lang="zh-TW">`）仍可作为补充缓解。
- **建议**：扩充 `TRADITIONAL_ONLY_CHARS` 集合，可从 Unicode 繁简对照表中批量导入。或改用更稳健的方案，例如基于 Unicode Block 的范围判断（CJK Unified Ideographs 中的 Extended B+ 区域）或引入第三方繁简转换库。

#### P2-2: `TRADITIONAL_ONLY_CHARS` 从数组转 Set 的开销

- **文件**：`src/1_content/utils/languageValidator.ts`，L216-226
- **问题**：字符集以数组形式定义，在模块加载时通过 `new Set(...)` 转换。数组长度约 200，开销可忽略，但**代码可读性差**——数组格式不利于维护（增删字符时需要手动管理一致性）。
- **建议**：
  ```typescript
  // 直接使用 Set，更干净
  const TRADITIONAL_ONLY_CHARS: Set<string> = new Set([
      "愛", "礙", "備", "筆", "畢", /* ... */
  ])
  ```

#### P2-3: `normalizeLangCode`（languageDetector.ts）不做区分但被正确调用链处理

- **文件**：`src/1_content/utils/languageDetector.ts`，L129
- **验证结果**：`normalizeLangCode` 将所有 `zh-*` 变体归一化为 `"zh"`，不修改它。其输出 `"zh"` 随后会被传入 `isSameLanguage`，进而走到 `zh` 族的简繁区分逻辑。两个函数的组合行为是正确的——`normalizeLangCode` 只负责返回主标签，`isSameLanguage` 负责简繁区分。✅
- **风险等级低**：只要调用链不变，没有问题。但如果未来有人直接使用 `normalizeLangCode` 的输出而不经过 `isSameLanguage`，会丢失简繁信息。
- **建议**：在 `normalizeLangCode` 的 JSDoc 中添加注释说明它输出主标签，简繁区分由 `isSameLanguage` 处理。

---

### P3 — 次要改进

#### P3-1: `LANGUAGE_NAME_MAP` 键名大小写不一致

- **文件**：`src/0_common/utils/languageDisplay.ts`，L7
- **代码**：``"zh-hant": "繁體中文"``
- **问题**：`LANGUAGE_NAME_MAP` 使用全小写键名 `"zh-hant"`，而 HTML option value 使用 `"zh-Hant"`（大写 H）。虽然 `getLanguageDisplayName()` 会先 `toLowerCase()` 再查找，兼容性没问题，但风格不一致。
- **建议**：统一为 `"zh-Hant"` 键名，或在 HTML 中将 value 统一为全小写。

#### P3-2: 重复的 `normalizeLanguageTagFull` / `normalizeLangTag` 命名不一致

- **文件**：`languageValidator.ts` L171 vs `pageLanguageChecker.ts` L93
- **问题**：两个函数执行完全相同的逻辑（`trim().toLowerCase().replace(/_/g, '-')`），但命名不同（`normalizeLanguageTagFull` vs `normalizeLangTag`）。如果因 P1-2 将二者提取为共享函数，此问题自然解决。

#### P3-3: `detectChineseScript` 中非中文/非空文本也返回 `"simplified"`

- **文件**：`src/1_content/utils/languageValidator.ts`，L232-238
- **代码**：
  ```typescript
  function detectChineseScript(text: string): "traditional" | "simplified" | "unknown" {
      if (!text) return "unknown"
      for (const char of text) {
          if (TRADITIONAL_ONLY_CHARS.has(char)) return "traditional"
      }
      return "simplified"  // ← 对纯英文/纯数字也返回 "simplified"
  }
  ```
- **问题**：函数签名声明可返回 `"unknown"`，但非空文本只返回 `"traditional"` 或 `"simplified"`。调用方 `shouldTriggerTranslationAsync` 在 `case "zh":` 分支中调用此函数，调用前已确认 Han 比例超过 5%，所以当前不存在纯英文文本被传入的风险。但函数本身的设计语义不准确。
- **建议**：当文本中不包含任何 Han 字符时返回 `"unknown"`，例如：
  ```typescript
  let hasHan = false
  for (const char of text) {
      if (TRADITIONAL_ONLY_CHARS.has(char)) return "traditional"
      if (REGEX_HAN.test(char)) hasHan = true
  }
  return hasHan ? "simplified" : "unknown"
  ```

#### P3-4: `REGEX_HAN` 等正则重复定义

- **文件**：`languageValidator.ts` L35-38、`pageLanguageChecker.ts` L13-16、`translationWalker.ts` L18-21
- **问题**：三个文件各自定义了相同的 Unicode 属性正则（`REGEX_HAN`、`REGEX_KANA`、`REGEX_HANGUL`、`REGEX_CYRILLIC`）。
  - `REGEX_HAN` 在 `languageValidator.ts` 是 `/\p{Script=Han}/gu`，在 `pageLanguageChecker.ts` 也是 `/\p{Script=Han}/gu`，在 `translationWalker.ts` 也是。
  - `REGEX_KANA` 和 `REGEX_HANGUL` 表达式完全相同。
  - `REGEX_CYRILLIC` 定义相同。
- **建议**：将共享正则提取到 `src/1_content/utils/charsets.ts` 或 `src/0_common/constants/regex.ts`。

---

## Open Questions

1. **Q1：`translationWalker.ts` 是否在本 PR 范围内修复？**
   - 技术方案中提到了 `promptLoader.ts` 的 split 风险，但未提及 `translationWalker.ts`。该文件的 `shouldSkipChineseTargetLanguageText` 对 `zh-Hant` 的错误截断会直接导致全页翻译功能缺陷。
   - 如果本 PR 不修复，建议至少在需求文档中标注已知限制，并单独开 Issue 跟进。

2. **Q2：共享工具函数的提取范围？**
   - `isSameLanguage`、`isTraditionalChinese`、`getMainSubtag` 是本次新增的核心逻辑，目前复制在两文件中。如果未来需要支持更多中文变体（如 `zh-Hans-SG` 新加坡简体、`zh-Hant-MO` 澳门繁体），需要在两处同步修改。
   - 建议本次 PR 就提取到共享模块（P1-2），避免技术债积累。

3. **Q3：繁体字检测是否需要引入第三方库？**
   - 当前 200 字符的 `TRADITIONAL_ONLY_CHARS` 是启发式方案。如果想彻底解决 P2-1，可考虑引入 `zhconverter` 或 `opencc-js` 做精确的简繁判别，但这会增加 Bundle 体积。
   - 权衡：启发式方案足够用（配合 `getPageDeclaredLanguage` 互补），但如果用户期望更高的检测准确率，建议制定中期优化计划。

4. **Q4：`LANGUAGE_NAME_MAP` 是否需要显式的 `"zh"` 显示名？**
   - 当前 `"zh"` 映射为 `"中文"`，但用户可能期望看到 `"简体中文"` 以示区分。当前 UI 上简体中文和繁体中文相邻排列，足以让用户理解，但也可能造成歧义。建议评估后决定。

---

## Change Summary

| # | 文件 | 变更类型 | 审查结论 |
|---|------|----------|----------|
| 1 | `src/3_popup/index.html` | 添加 `<option value="zh-Hant">繁體中文</option>` | ✅ 通过，纯 UI 添加 |
| 2 | `src/4_options/index.html` | 同上 | ✅ 通过，纯 UI 添加 |
| 3 | `src/0_common/utils/languageDisplay.ts` | `LANGUAGE_NAME_MAP` 新增 `"zh-hant"` 条目 | ✅ 通过，注意 P3-1 大小写不一致 |
| 4 | `src/0_common/utils/storageManager.ts` | `SUPPORTED_LANGUAGES` + `detectBrowserLanguage` 修改 | ✅ 通过，边界处理正确 |
| 5 | `src/1_content/utils/languageValidator.ts` | 核心逻辑重构（`isSameLanguage`/`detectChineseScript`/`isTraditionalChinese`/`getMainSubtag`/`normalizeLanguageTagFull`） | ⚠️ 有条件通过 — P1-2 代码重复 + P2-1 字集不完整 |
| 6 | `src/1_content/utils/pageLanguageChecker.ts` | 同上逻辑同步 | ⚠️ 有条件通过 — P1-2 代码重复 + P1-3 逻辑差异 |
| 7 | `tests/1_content/utils/languageValidator.unit.test.ts` | 回归测试适配 | ✅ 通过，测试覆盖充分 |
| — | `src/11_full_translate/dom/translationWalker.ts` | **未修改**（但受影响） | ❌ **需修复** — P1-1 `split` 截断问题 |

### 兼容性矩阵验证

对现有 8 种目标语言的翻译抑制逻辑进行逻辑推演：

| 目标语言 | 页面语言 | 原行为 | 新行为 | 是否正确 |
|----------|----------|--------|--------|----------|
| `zh` | `zh-CN`（简体页面） | 抑制 | 抑制（简体=简体） | ✅ |
| `zh` | `zh-TW`（繁体页面） | 抑制 | **触发**（繁体≠简体） | ✅ 正确，用户选简体应触发翻译 |
| `zh-Hant` | `zh-CN`（简体页面） | — | **触发**（简体≠繁体） | ✅ 核心用例 |
| `zh-Hant` | `zh-TW`（繁体页面） | — | 抑制（繁体=繁体） | ✅ |
| `en` | `en-US` | 触发 | 触发 | ✅ 保持 |
| `en` | `en-GB` | 触发 | 触发 | ✅ 保持 |
| `ja` | `ja` 页面 | 抑制（Kana） | 抑制（Kana） | ✅ 保持 |
| `ko` | `ko` 页面 | 抑制（Hangul） | 抑制（Hangul） | ✅ 保持 |
| `ru` | `ru` 页面 | 抑制（Cyrillic） | 抑制（Cyrillic） | ✅ 保持 |
| `es` | `es` 页面 | 抑制 | 抑制 | ✅ 保持 |

**结论**：中文族的简繁区分逻辑正确，非中文族行为与改动前一致，回归风险低。

---

## Residual Risks

| # | 风险 | 严重性 | 缓解措施 |
|---|------|--------|----------|
| R1 | **全页翻译 zh-Hant 失效**（`translationWalker.ts` 未修复） | 🔴 高 | 需在本 PR 或后续 PR 修复 `shouldSkipChineseTargetLanguageText` 中的 split 截断 |
| R2 | **`detectChineseScript` 启发式误判** | 🟡 中 | 短繁体文本可能被误判为简体，导致不必要的翻译触发（非阻塞性） |
| R3 | **重复代码导致未来不一致修改** | 🟡 中 | `isSameLanguage` 等在两个文件中的副本，需手动保持同步 |
| R4 | **用户升级后行为变化** | 🟢 低 | 老用户如果在简体页面上目标为 `zh`（旧行为：抑制→正确），升级后行为不变。老用户默认 targetLanguage 仍为存储的值（`zh`），不会自动切换为 `zh-Hant` |
| R5 | **Custom LLM / Official Cloud API 对 zh-Hant 的支持** | 🟢 低 | 技术方案已标注为不确定，但不在本 PR 范围内 |
| R6 | **BCP 47 边界情况**：`zh-Hans-CN`（带 script 和 region 的完整标签） | 🟢 低 | `isTraditionalChinese` 检查 `includes("hant")`，`zh-Hans-CN` 返回 `false`（简体），`zh-Hant-HK` 返回 `true`（繁体）。行为正确。但如果遇到 `zh-cmn-Hant`（Mandarin Chinese with Traditional script），`includes("hant")` 也会正确匹配 |

---

## 总体评估

**建议：有条件通过，修复 P1 项后合并。**

本次 PR 的核心逻辑（`isSameLanguage` 简繁区分）设计合理，错误处理到位，类型安全，对现有语言的回归风险很低。测试覆盖（`languageValidator.unit.test.ts`）已适配。主要阻塞项为 P1 级的 `translationWalker.ts` 截断问题和代码重复问题。

如果是 Reviewer A 和 Reviewer B 双模型并审，**任一发现的问题都需修复**后才算通过。本报告中的 P1 项均建议在合并前解决。
