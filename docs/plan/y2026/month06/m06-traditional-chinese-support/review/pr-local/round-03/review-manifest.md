# Code Change Handoff Manifest — 繁体中文支持（Round 03）

## 1. Change Context

- **Related Documents**:
  - `requirement.md` — 需求文档
  - `proposal.md` — 技术方案（方案 B）
  - `test-report.md` — 测试报告
- **Task Objectives**:
  - 在翻译目标语言列表中新增繁体中文（zh-Hant）
  - Round 02 Review 发现 3 个 P1 问题，本轮修复后重新审查
- **AI Disclaimer**: 本代码由 AI 助手基于技术方案和本地代码检查生成，不保证代码逻辑完全正确，审查者必须独立验证。

## 2. P1 修复说明（Round 02 → Round 03）

| P1 # | 问题 | 修复方式 |
|-------|------|----------|
| 1 | detectChineseScript 同形文本误判 | zh-case 中将 pageDeclaredLanguage 检查提到文本分析之前 |
| 2 | 6+ 函数重复 + getPageDeclaredLanguage 逻辑分叉 | 提取共享模块 `languageTagUtils.ts`，统一两文件 import |
| 3 | translationWalker.ts split 截断 | 新增 zh-Hant 分支，仅跳过已含繁体字的文本 |

## 3. File Change Audit（Round 03 审查范围）

| File Path | Change Type | Lines Changed | Objective |
| :--- | :--- | :--- | :--- |
| `src/3_popup/index.html` | Add | +1 | 添加 zh-Hant option |
| `src/4_options/index.html` | Add | +1 | 同上 |
| `src/0_common/utils/languageDisplay.ts` | Mod | +1 | LANGUAGE_NAME_MAP 新增 |
| `src/0_common/utils/storageManager.ts` | Mod | +11/-4 | detectBrowserLanguage 精确匹配 |
| `src/0_common/utils/languageTagUtils.ts` | **New** | +58 | 共享语言标签工具模块 |
| `src/1_content/utils/languageValidator.ts` | Mod | +125/-55 | 核心逻辑 + P1-1 修复 + import 共享模块 |
| `src/1_content/utils/pageLanguageChecker.ts` | Mod | +29/-7 | import 共享模块 + 统一 getPageDeclaredLanguage |
| `src/11_full_translate/dom/translationWalker.ts` | Mod | +32 | P1-3: zh-Hant 分支 |
| `tests/.../languageValidator.unit.test.ts` | Mod | +4/-4 | 回归测试适配 |

## 4. Reviewer Risk Checklist

- [ ] **P1-1 修复有效性**：zh-TW 页面选「你好世界」+ zh-Hant 目标 → 应被 pageDeclaredLanguage 先行抑制
- [ ] **P1-2 共享模块正确性**：import 后行为是否与原内联定义一致
- [ ] **P1-3 translationWalker 逻辑**：zh-Hant 分支是否正确——仅跳过含繁体字的文本
- [ ] **getPageDeclaredLanguage 统一**：两版本现在逻辑一致（含 ogLocale===contentLanguage 检查）
- [ ] **回归风险**：现有 zh/en/ja/ko/ru 行为不受影响
- [ ] **安全性**：XSS / 注入 / MV3 合规
