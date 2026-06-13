# Code Review Report — 翻译目标语言支持繁体中文（Round 02）

> **审查日期**: 2026-06-13
> **审查模式**: 双模型并行 Review
> - **Reviewer A**: openai/gpt-5.5（thinking=high）
> - **Reviewer B**: deepseek/deepseek-v4-pro（thinking=max）
> **审查范围**: 7 个变更文件 + 1 个受影响的关联文件

---

## 最终结论：⚠️ CHANGES_REQUESTED（双模型均未完全 APPROVED）

两位 Reviewer 都认为核心设计方向正确、安全性无问题、非中文族回归风险低，但均发现了需要修复的问题才可合并。

---

## 1. 双模型 Review 结论

| Reviewer | P0 | P1 | P2 | P3 | 结论 |
|----------|----|----|----|----|------|
| **A (GPT-5.5)** | 0 | 1 | 2 | 1 | ⚠️ 有条件通过 |
| **B (DeepSeek V4 Pro)** | 0 | 3 | 3 | 4 | ⚠️ 有条件通过 |

---

## 2. 问题汇总（取并集，按严重性排序）

### P0 — 阻塞合并

无。

### P1 — 合并前必须处理

| # | 问题 | 发现者 | 文件 | 说明 |
|---|------|--------|------|------|
| 1 | **translationWalker.ts 截断** | B | `src/11_full_translate/dom/translationWalker.ts:131` | `split(/[-_]/)[0]` 将 zh-Hant 截断为 zh，导致全页翻译路径中简→繁翻译失效。该文件不在 proposal 改动范围内，但属于功能的直接影响对象。**裁定**：创建 follow-up issue，不阻塞本 PR。 |
| 2 | **代码重复（6+ 函数）** | A + B | languageValidator.ts ↔ pageLanguageChecker.ts | `isSameLanguage`/`isTraditionalChinese`/`getMainSubtag`/`normalizeLanguageTagFull`/`normalizeLocaleMeta`/正则定义在两文件中完全复制，且 `getPageDeclaredLanguage` 两版本已出现逻辑差异（A 版本检查 ogLocale===contentLanguage 一致性，B 版本直接短路）。**裁定**：建议本 PR 提取共享模块，或至少创建技术债 issue。 |
| 3 | **getPageDeclaredLanguage 逻辑分叉** | B | 同上 | languageValidator 版本验证 ogLocale 与 contentLanguage 一致性后再采纳；pageLanguageChecker 版本直接 `||` 短路。**裁定**：统一逻辑，合并到共享模块时自然解决。 |
| 4 | **detectChineseScript 对繁简同形文本误判** | A | languageValidator.ts:86-109 | 繁体页面（zh-TW）上选中「你好世界」等繁简同形文本 + 目标 zh-Hant 时，detectChineseScript 返回 "simplified" → 绕过页面语言抑制 → 不必要地触发翻译。**裁定**：GPT-5.5 标为 P1。这是一个真实的抑制逻辑漏洞，但在实际场景中影响有限（翻译引擎会返回相同文本）。建议在 `unknown` 时参考 pageDeclaredLanguage。 |

### P2 — 建议本 PR 或紧随修复

| # | 问题 | 发现者 | 说明 |
|---|------|--------|------|
| 5 | detectChineseScript 字符集不完整 | A + B | 约 280 字符，缺少 測、試、練、體、處、變、關、讓 等常见繁体字。假阴性不会导致错误抑制（安全），但会漏掉抑制机会 |
| 6 | detectLanguageFromContent 不区分简繁 | A + B | 无 html lang 元数据的繁体页面 + 目标 zh-Hant 时浮动按钮仍显示 |
| 7 | detectBrowserLanguage 漏掉 zh-MO 等 | A | zh-MO、zh-Hant-TW、zh-Hant-HK 等合法标签会 fallback 到 zh |
| 8 | TRADITIONAL_ONLY_CHARS 数组转 Set 可读性 | B | 建议直接用 Set 定义 |

### P3 — 可选跟进

| # | 问题 | 发现者 |
|---|------|--------|
| 9 | LANGUAGE_NAME_MAP 键名大小写不一致 | B |
| 10 | 归一化函数命名不一致 | A + B |
| 11 | detectChineseScript 对非中文返回 "simplified" | B |
| 12 | 正则重复定义（3 个文件） | B |

---

## 3. 共识 vs 独有

### 双模型共识（都发现的问题）
- ✅ 代码重复（P1/P3 → 取高：P1）
- ✅ detectChineseScript 字符集不完整（P2）
- ✅ detectLanguageFromContent 不区分简繁（P2）

### Reviewer A (GPT-5.5) 独有
- detectChineseScript 繁简同形文本误判（P1）— **关键发现**，B 未注意到

### Reviewer B (DeepSeek V4 Pro) 独有
- translationWalker.ts 截断（P1）— 范围外但重要
- getPageDeclaredLanguage 逻辑分叉（P1）— **关键发现**，A 未注意到
- detectBrowserLanguage 漏掉 zh-MO（P2）
- TRADITIONAL_ONLY_CHARS 数组转 Set（P2）
- detectChineseScript 非中文返回 "simplified"（P3）
- 正则重复定义（P3）

---

## 4. 安全性检查

| 项目 | Reviewer A | Reviewer B | 结论 |
|------|-----------|-----------|------|
| XSS | ✅ 无风险 | ✅ 无风险 | 无 DOM 操作、无 innerHTML |
| 注入 | ✅ 无风险 | ✅ 无风险 | 无 eval、无动态代码 |
| 数据泄露 | ✅ 无风险 | ✅ 无风险 | 无网络请求新增 |
| 权限扩展 | ✅ 无风险 | ✅ 无风险 | manifest.json 未修改 |
| MV3 合规 | ✅ 安全 | ✅ 安全 | service worker 无新持久状态 |

---

## 5. 合并建议

### 必须处理（阻塞合并）
1. **P1-4 detectChineseScript 繁简同形文本误判**：修改 `detectChineseScript` 返回 `"unknown"` 时不直接判定简体，而是参考 `pageDeclaredLanguage` 做最终决定。或调整 `shouldTriggerTranslationAsync` zh-case 中的判断顺序：先检查 pageDeclaredLanguage 抑制，再检查文本语言。

### 强烈建议（本 PR 处理或创建 issue）
2. **P1-2 代码重复 + P1-3 逻辑分叉**：提取共享模块 `languageTagUtils.ts`，消除逻辑差异。
3. **P1-1 translationWalker.ts**：创建 follow-up issue 修复全页翻译路径。

### 可选（P2/P3）
4. 修复拼写错误 "coalescling" → "coalescing"
5. 扩充 TRADITIONAL_ONLY_CHARS 字符集
6. 补充 zh-MO 等浏览器语言标签匹配

---

## 6. 产出物清单

| 文件 | 说明 |
|------|------|
| `review/pr-local/round-02/review-manifest.md` | 审查清单 |
| `review/pr-local/round-02/subreviews/reviewer-a-gpt55.md` | GPT-5.5 完整报告 |
| `review/pr-local/round-02/subreviews/reviewer-b-deepseek.md` | DeepSeek V4 Pro 完整报告 |
| `review/pr-local/round-02/final-review.md` | 本文件 |
