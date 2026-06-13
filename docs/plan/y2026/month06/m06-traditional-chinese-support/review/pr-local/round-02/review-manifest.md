# Code Change Handoff Manifest — 繁体中文支持

## 1. Change Context

- **Related Documents**:
  - `docs/plan/y2026/month06/m06-traditional-chinese-support/requirement.md`
  - `docs/plan/y2026/month06/m06-traditional-chinese-support/proposal.md`
  - `docs/plan/y2026/month06/m06-traditional-chinese-support/test-report.md`
- **Task Objectives**:
  - 在翻译目标语言列表中新增繁体中文（`zh-Hant`），修改 UI/存储/显示/翻译抑制逻辑
  - 核心修复：将 `zh-*` 语言族的比较从「截断为主标签」升级为「保留完整 BCP 47 标签 + 简繁智能区分」
- **AI Disclaimer**: 本代码由 AI 助手基于技术方案和本地代码检查生成，**不保证代码逻辑完全正确**，审查者必须独立验证。

## 2. File Change Audit

| File Path | Change Type | Objective Description |
| :--- | :--- | :--- |
| `src/3_popup/index.html` | Add | 添加 `<option value="zh-Hant">繁體中文</option>` 选项 |
| `src/4_options/index.html` | Add | 同上，保持 popup 和 options 一致 |
| `src/0_common/utils/languageDisplay.ts` | Mod | `LANGUAGE_NAME_MAP` 新增 `"zh-hant": "繁體中文"` 映射 |
| `src/0_common/utils/storageManager.ts` | Mod | `detectBrowserLanguage()` 在 split 回退前增加 zh-TW/zh-HK/zh-Hant 精确匹配 |
| `src/1_content/utils/languageValidator.ts` | Mod | 核心：新增 `isSameLanguage`/`isTraditionalChinese`/`detectChineseScript`/`getMainSubtag`/`normalizeLanguageTagFull`；重写 zh-case 简繁区分；`getPageDeclaredLanguage` 保留完整标签 |
| `src/1_content/utils/pageLanguageChecker.ts` | Mod | 同步：复制相同的语言比较函数；`normalizeLangTag` 保留完整标签 |
| `tests/1_content/utils/languageValidator.unit.test.ts` | Mod | 1 个回归测试适配：`xmlLang: "zh-TW"` → `"zh-CN"` |

## 3. Reviewer Risk Checklist

- [ ] **Logical Consistency**: `detectChineseScript` 对繁简同形短文本（如「你好世界」）返回 `"simplified"`，可能导致繁体页面上绕过翻译抑制
- [ ] **Code Duplication**: 6+ 个函数在 `languageValidator.ts` 和 `pageLanguageChecker.ts` 中完全复制，且 `getPageDeclaredLanguage` 两版本已出现逻辑差异
- [ ] **Scope Completeness**: `translationWalker.ts` 仍使用 `split` 截断 zh-Hant，全页翻译路径可能失效
- [ ] **Edge Cases**: `detectBrowserLanguage` 漏掉 `zh-MO`、`zh-Hant-TW` 等标签
- [ ] **Character Set Coverage**: `TRADITIONAL_ONLY_CHARS` 约 280 字符，缺少 測、試、練、體 等常见繁体字
