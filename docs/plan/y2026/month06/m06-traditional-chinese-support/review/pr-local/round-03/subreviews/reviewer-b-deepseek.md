# Code Review Report — 繁体中文支持 Round 03（Reviewer B: DeepSeek V4 Pro）

> **审查日期**: 2026-06-13
> **审查模式**: 单模型深度审查（Round 03 修复后验证）
> **审查范围**: 9 个变更/受影响文件
> **基础**: Round 02 双模型审查报告中的 3 个 P1 + Round 03 Manifest

---

## Round 02 P1 修复验证

### P1-1 验证结果：✅ 已正确修复

**问题描述**：`detectChineseScript` 对繁简同形文本（如「你好世界」）返回 `"simplified"`，导致繁体页面（zh-TW）+ 目标 zh-Hant 时绕过页面语言抑制，不必要地触发翻译。

**验证方法**：追踪 `shouldTriggerTranslationAsync` 中 `tgtMain === "zh"` 分支的控制流。

**关键代码**（`languageValidator.ts` lines 86-93）：
```typescript
// 2. Check page's declared language FIRST (before text analysis)
// This handles the case where the page declares zh-TW/zh-Hant and target is zh-Hant,
// even if the selected text itself is script-neutral (e.g., "你好世界").
if (pageDeclaredLanguage && isSameLanguage(pageDeclaredLanguage, tgtLang)) {
    logger.debug("Suppressing translation: page metadata declares same Chinese variant", {
        pageDeclaredLanguage, tgtLang,
    })
    return false
}
```

**控制流顺序验证**：
1. Step 1: Kana 检查 → ❌ 无 Kana → 继续
2. **Step 2: pageDeclaredLanguage 检查** → `isSameLanguage("zh-tw", "zh-hant")` → 两者均为 Traditional → `true` → **suppress → return false** ✅
3. Step 3（第二步之后才到达）: Han ratio 文本分析 — **不会被执行**

**场景遍历**：

| 场景 | pageDeclaredLanguage | 文本 | tgtLang | 期望 | 实际 |
|------|---------------------|------|---------|------|------|
| zh-TW 页面 + 繁简同形 | zh-tw | 你好世界 | zh-Hant | suppress | **suppress ✅** |
| zh-CN 页面 + 简体文本 | zh-cn | 你好世界 | zh | suppress | suppress ✅ |
| zh-TW 页面 + 简体文本 | zh-tw | 你好世界 | zh | trigger | trigger ✅ |
| 无 lang 声明 + 简繁同形 | "" | 你好世界 | zh-Hant | trigger（文本无繁体特征→翻译简→繁） | trigger ✅ |

**结论**：P1-1 修复有效。`pageDeclaredLanguage` 检查在 `detectChineseScript` 之前执行，繁简同形文本在繁体页面上被正确抑制。

---

### P1-2 验证结果：✅ 已正确修复

**问题描述**：`languageValidator.ts` 和 `pageLanguageChecker.ts` 中有 6+ 重复函数，且 `getPageDeclaredLanguage` 出现逻辑分叉。

**验证方法**：对比共享模块定义、两文件 import、两文件 `getPageDeclaredLanguage` 逻辑。

#### 共享模块验证（`languageTagUtils.ts`）

| 函数 | 签名 | 行为 | 正确性 |
|------|------|------|--------|
| `normalizeLanguageTagFull(tag)` | `string \| null \| undefined → string` | lowercase + `_`→`-`，null/undefined → `""` | ✅ |
| `normalizeLocaleMeta(content)` | `string \| null \| undefined → string` | 取逗号前第一段，lowercase + `_`→`-` | ✅ |
| `isTraditionalChinese(lang)` | `string → boolean` | `includes("hant"\|"tw"\|"hk"\|"mo")` | ✅ |
| `getMainSubtag(lang)` | `string → string` | `split("-")[0]`，lowercase | ✅ |
| `isSameLanguage(pageLang, targetLang)` | `(string, string) → boolean` | 主标签相同则 `true`；zh 系列比较繁/简一致性 | ✅ |

#### Import 验证

**languageValidator.ts**：
```typescript
import {
    normalizeLanguageTagFull,
    normalizeLocaleMeta,
    getMainSubtag,
    isSameLanguage,
} from "@/0_common/utils/languageTagUtils"
```
使用 `@/` 前缀 ✅ | namespace 导入 ✅ | 4 个函数均被使用 ✅

**pageLanguageChecker.ts**：
```typescript
import {
    normalizeLanguageTagFull as normalizeLangTag,
    normalizeLocaleMeta,
    isSameLanguage,
} from '@/0_common/utils/languageTagUtils';
```
使用 `@/` 前缀 ✅ | namespace 导入 ✅ | `normalizeLangTag` 仅本地别名 ✅

#### `getPageDeclaredLanguage` 逻辑统一验证

**languageValidator.ts (lines 27-49)**：
```typescript
function getPageDeclaredLanguage(): string {
    // html lang → xml:lang → og:locale ↔ content-language 一致性检查
    if (ogLocale && contentLanguage && ogLocale === contentLanguage) return ogLocale;
    return ogLocale || contentLanguage || "";
}
```

**pageLanguageChecker.ts (lines 38-62)**：
```typescript
function getPageDeclaredLanguage(): string {
    // 完全相同的逻辑顺序和一致性检查
    // Consistency check: only accept meta tags if they agree
    if (ogLocale && contentLanguage && ogLocale === contentLanguage) return ogLocale;
    return ogLocale || contentLanguage || '';
}
```

两版本**逻辑完全一致**，包括：
- `htmlLang` → `xml:lang` → `ogLocale/contentLanguage` 优先级链 ✅
- `ogLocale === contentLanguage` 一致性检查 ✅
- 空字符串回退 ✅

**差异**：仅格式化风格（换行方式、引号类型），逻辑等价。

**结论**：P1-2 修复有效。共享模块设计正确，import 均正确引用，`getPageDeclaredLanguage` 逻辑完全统一。

---

### P1-3 验证结果：✅ 已正确修复

**问题描述**：`translationWalker.ts` 中 `shouldSkipChineseTargetLanguageText` 使用 `split(/[-_]/)[0]` 将 `zh-Hant` 截断为 `zh`，导致全页翻译路径中简→繁翻译失效。

**验证方法**：追踪 `shouldSkipChineseTargetLanguageText` 中 zh-Hant 分支的控制流。

**关键代码**（`translationWalker.ts`）：
```typescript
// 不截断 targetLanguage，保留完整 subtag 用于繁/简判断
const isTraditionalTarget = (targetLanguage || '').toLowerCase().includes('hant') ||
                            (targetLanguage || '').toLowerCase().includes('tw') ||
                            (targetLanguage || '').toLowerCase().includes('hk');

// ... Han count 检查 ...

// zh-Hant 专用分支
if (isTraditionalTarget) {
    const hasTraditional = checkHasTraditionalChars(trimmed);
    if (hasTraditional) return true;   // 已是繁体 → 跳过
    return false;                       // 简体或无繁体特征 → 需翻译
}
```

**场景遍历**：

| 场景 | targetLanguage | 文本 | 期望 | 实际逻辑 |
|------|---------------|------|------|---------|
| 目标 zh-Hant + 繁体文本 | zh-Hant | 臺灣的傳統文化 | skip | `hasTraditional=true → skip ✅` |
| 目标 zh-Hant + 简体文本 | zh-Hant | 台湾的传统文化 | translate | `hasTraditional=false → don't skip ✅` |
| 目标 zh-Hant + 繁简同形 | zh-Hant | 你好世界 | translate | `hasTraditional=false → don't skip ✅` |
| 目标 zh + 中文文本 | zh | 任何中文文本 | skip（原行为） | `isTraditionalTarget=false → 走原逻辑 ✅` |
| 目标 zh-Hant + 英文文本 | zh-Hant | Hello world | translate | `hanCount<2 → return false ✅` |

#### 字符集一致性验证

对比 `languageValidator.ts` 的 `TRADITIONAL_ONLY_CHARS` 和 `translationWalker.ts` 的 `TRADITIONAL_INDICATOR_CHARS`：

- **定义方式**：两者均使用 `new Set("...".split(""))` ✅
- **字符集内容**：逐个比对，**完全一致**（同一起源字符集） ✅
- **差异**：变量名不同（`TRADITIONAL_ONLY_CHARS` vs `TRADITIONAL_INDICATOR_CHARS`），但在各自模块内语义合理

**结论**：P1-3 修复有效。zh-Hant 分支逻辑正确，仅跳过已含繁体字的文本，简体/中性文本正确送入翻译流水线。字符集与 languageValidator 一致。

---

## New Findings

### P0 — 阻塞合并

**无。**

---

### P1 — 合并前必须处理

**无。**

---

### P2 — 建议本 PR 或紧随修复

#### P2-1：TRADITIONAL 字符集两处定义，缺乏同步保障

- **文件**：`languageValidator.ts`（`TRADITIONAL_ONLY_CHARS`）和 `translationWalker.ts`（`TRADITIONAL_INDICATOR_CHARS`）
- **问题**：同一字符集在两处独立定义，未来若扩充字符集（如添加 測、試、練、體 等常见繁体字），可能仅修改一处，导致两处行为不一致
- **当前影响**：目前两处字符集**完全一致**，无实际 bug
- **建议**：
  - 方案 A：将字符集提取到 `languageTagUtils.ts`，导出为 `TRADITIONAL_CHAR_SET`，两处均从该模块引用
  - 方案 B：至少在两处定义旁添加交叉引用注释（如 `// Keep in sync with TRADITIONAL_ONLY_CHARS in languageValidator.ts`）
- **裁定**：不阻塞合并，但建议建 tech debt issue 跟进

#### P2-2：拼写错误未修复

- **文件**：`storageManager.ts` line 227
- **问题**：注释中 `"coalescling"` → 应为 `"coalescing"`
- **说明**：Round 02 已标注但本轮未修复（可能不属于 P1 修复范围）
- **建议**：在后续清理中修复

#### P2-3：测试覆盖缺口 — P1-1 核心场景无显式测试

- **文件**：`tests/1_content/utils/languageValidator.unit.test.ts`
- **问题**：测试文件中没有覆盖 P1-1 的核心场景（`pageDeclaredLanguage` 先于文本分析的抑制逻辑）。当前 `Page Metadata Detection` 测试套件只覆盖了 `html lang` 对所有文本（包括英文 "Release"）的抑制，但没有显式测试「zh-TW 页面 + 繁简同形中文文本 + zh-Hant 目标」场景
- **风险等级**：低 — 逻辑推理已验证正确，但缺少回归测试保障
- **建议**：添加测试用例：
  ```typescript
  it("suppresses script-neutral Chinese text on zh-TW page for zh-Hant target", async () => {
      stubDocumentLanguageSignals({ htmlLang: "zh-TW" })
      expect(await shouldTriggerTranslationAsync("你好世界", "zh-Hant")).toBe(false)
      vi.unstubAllGlobals()
  })
  ```

#### P2-4：zh-Hant 分支缺少 `toLowerCase()` 一致性保护

- **文件**：`translationWalker.ts`，`shouldSkipChineseTargetLanguageText` 函数
- **问题**：函数开始处已做 `normalizedTarget = (targetLanguage || '').toLowerCase()`，但后续的 `isTraditionalTarget` 检测中又**重复**对 `targetLanguage` 做了 `toLowerCase()`：
  ```typescript
  const isTraditionalTarget = (targetLanguage || '').toLowerCase().includes('hant') || ...
  ```
  此处存在两个 `toLowerCase()` 调用，虽然结果相同，但代码有重复且不一致（一个用 `normalizedTarget`，一个重新 `toLowerCase`）
- **建议**：统一使用 `normalizedTarget` 或 `tgt` 变量做繁简判断，避免重复转换

---

### P3 — 可选改进

#### P3-1：`languageTagUtils.ts` 缺少 JSDoc 注释说明子串匹配的安全性

- **文件**：`languageTagUtils.ts`，`isTraditionalChinese` 函数
- **问题**：使用 `lower.includes("tw")` 等进行子串匹配，但未注释说明为什么这是安全的（因为调用方仅在 `pageMain === "zh" && targetMain === "zh"` 时才调用，所以不会误匹配 `twi` 等语言代码）
- **建议**：添加注释说明上下文保证安全性

#### P3-2：`translationWalker.ts` 繁体判断分支缺少 debug 日志

- **文件**：`translationWalker.ts`，`shouldSkipChineseTargetLanguageText` 和 `checkHasTraditionalChars`
- **问题**：与 `languageValidator.ts` 不同，全页翻译路径的繁简判断没有任何 logger 日志，不利于线上调试简→繁翻译行为
- **建议**：在 `isTraditionalTarget` 分支的 skip/translate 决策点添加 logger.debug

#### P3-3：`storageManager.ts` 的 `detectBrowserLanguage` 可用 `getMainSubtag`

- **文件**：`storageManager.ts`，`detectBrowserLanguage` 函数
- **问题**：`detectBrowserLanguage` 中手动 `browserLang.split("-")` 提取主标签，可以用 `languageTagUtils.ts` 的 `getMainSubtag`
- **说明**：这不在本 PR 的变更范围内，且 `detectBrowserLanguage` 有自己的 `SUPPORTED_LANGUAGES` 检查逻辑，`getMainSubtag` 的行为一致但引入依赖会增加耦合
- **建议**：可选清理，不阻塞

---

## 安全性检查

| 检查项 | 结论 | 说明 |
|--------|------|------|
| XSS | ✅ 无风险 | 无 DOM 操作、无 innerHTML 写入 |
| 注入 | ✅ 无风险 | 无 eval、无动态代码执行 |
| 数据泄露 | ✅ 无风险 | 无新增网络请求 |
| 权限扩展 | ✅ 无风险 | manifest.json 未修改 |
| MV3 合规 | ✅ 无风险 | content script 无新持久状态 |

---

## 回归风险评估

| 语言 | 场景 | 行为 | 结论 |
|------|------|------|------|
| zh | 简体文本 + 目标 zh | suppress（isSameLanguage） | ✅ 未变 |
| zh | 英文文本 + 目标 zh（无 page lang） | trigger | ✅ 未变 |
| zh-Hant | 繁体文本 + 目标 zh-Hant | suppress（pageDeclaredLanguage + Han ratio） | ✅ 新增，正确 |
| zh-Hant | 简体文本 + 目标 zh-Hant | trigger | ✅ 新增，正确 |
| ja | Kana 文本 + 目标 ja | suppress | ✅ 未变 |
| ja | Kanji 文本 + 目标 ja | trigger | ✅ 未变 |
| ko | Hangul + 目标 ko | suppress | ✅ 未变 |
| ru | Cyrillic + 目标 ru | suppress | ✅ 未变 |
| en | 任意文本 + 目标 en | trigger（always） | ✅ 未变 |
| es/fr/de | 上下文匹配 + 目标 | suppress（async detect） | ✅ 未变 |
| es/fr/de | page lang 匹配 + 目标 | suppress（pageDeclaredLanguage） | ✅ 未变 |

---

## 共享模块设计评估

| 检查项 | 结论 |
|--------|------|
| 模块位置（`src/0_common/utils/`） | ✅ 符合项目架构（共享工具在 0_common） |
| 循环依赖 | ✅ 无 — `0_common` → `1_content`（单向） |
| `0_common` → `11_full_translate` 依赖 | ✅ translationWalker 不依赖 languageTagUtils（有独立字符集） |
| 纯函数 | ✅ 所有导出函数无副作用 |
| null/undefined 安全 | ✅ 所有函数有空值守卫 |

---

## Overall Verdict

**APPROVED** ✅

所有 3 个 Round 02 P1 问题均已正确修复：
- P1-1：`pageDeclaredLanguage` 检查已正确前置，繁简同形文本在繁体页面上被抑制
- P1-2：共享模块设计正确，逻辑统一，import 均正确
- P1-3：zh-Hant 分支逻辑正确，仅跳过已含繁体字的文本

无 P0/P1 新发现。2 个 P2 建议可在后续跟进，均不阻塞合并。安全性无风险，现有语言回归风险可控。

---

## Residual Risks

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| 字符集不完整 | 低 | 约 280 字符，假阴性（漏判）不会导致错误翻译，仅漏掉抑制机会 | 后续扩充字符集 |
| 字符集同步风险 | 低 | 两处独立定义，未来修改可能不同步 | 建议提取到共享模块（P2-1） |
| 测试覆盖缺口 | 低 | P1-1 核心场景无显式测试 | 建议添加（P2-3） |
| `detectChineseScript` 对非中文返回 `"simplified"` | 极低 | 已在 Han ratio check 之后才调用，非中文文本不会到达此处 | 现有守卫充分 |

---

## 产出物清单

| 文件 | 说明 |
|------|------|
| `review/pr-local/round-03/subreviews/reviewer-b-deepseek.md` | 本文件 |
