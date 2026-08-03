# PR #65 繁体中文支持与 PR #60 全文翻译/多Provider 功能兼容性调研

## 背景

PR #65「翻译目标语言支持繁体中文 (zh-Hant)」在 PR #60「全文翻译 + 多 Provider 引擎管理」合入 main 后 rebase，两者存在代码交叉。PR #65 改动了 `src/11_full_translate/dom/translationWalker.ts`，与全文翻译模块有直接交互。需要调研是否存在冲突、遗漏或不兼容。

## 目标

确认 PR #65 的代码与 PR #60 的全文翻译 + 多 Provider 功能完全兼容，识别遗漏和风险，给出是否需要改动的结论。

## 范围

### 包含
- PR #65 改动文件与 PR #60 新增/修改文件的交叉分析
- 全文翻译流程对繁体中文目标语言的支持完整性
- 多 Provider 场景下繁体中文的行为一致性
- i18n locales 文件的覆盖完整性
- languageValidator / pageLanguageChecker 对 zh-Hant 的覆盖

### 不包含
- 代码修改（本次只调研，不开发）
- 选中文本翻译流程的繁体中文支持（仅聚焦全文翻译链路）

## 用户场景

1. 用户将翻译目标语言设为繁体中文，点击全文翻译按钮，整页翻译为繁体中文
2. 用户切换不同 Provider（OpenAI / Google / DeepSeek），全文翻译为繁体中文行为一致

## 验收标准

- [ ] 5 个调研要点逐一回答（代码交叉、功能兼容、多Provider、遗漏风险、结论建议）
- [ ] 明确结论：需要改动 / 不需要改动
- [ ] 如需改动，列出具体文件和改动范围
- [ ] 如不需要改动，说明理由

## 关联信息

- PR #65 分支：`feat/260613/traditional-chinese-support`
- PR #60 已合入 main，包含 `src/11_full_translate/` 模块和多 Provider 引擎管理
- 当前分支已基于最新 main，包含 PR #60 全部改动
