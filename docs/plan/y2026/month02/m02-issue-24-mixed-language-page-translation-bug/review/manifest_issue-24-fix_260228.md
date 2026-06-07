
### 1. 变更背景 (Context)
- **关联文档**: `docs/plan/y2026/m02-issue-24-mixed-language-page-translation-bug/260228-bug-analysis-and-fix.md`
- **任务目标**: 试图修复 Issue #24，即在中文（CJK）网页中选中英文单词时，翻译结果错误地保持为英文的问题。同时试图增强对中英混合短语（如 "you什么时候来"）的语言识别处理。

### 2. 文件变更审计 (Change Audit)
| 文件路径 | 变更类型 | 客观变更描述 (Objective Description) |
| :--- | :--- | :--- |
| `src/1_content/handlers/TranslationPipeline.ts` | Mod | 修改了 `processTranslation` 函数。引入了双重语言检测机制：保留基于块级上下文的检测 (`routingLang`) 用于路由决策，新增基于选区内容的检测 (`selectionLang`) 用于 API 请求。增加了启发式逻辑：若检测为 CJK 但包含拉丁字母，强制将 `selectionLang` 设为 `en`。 |
| `tests/html/mixed_language_scenarios.html` | New | 创建了一个新的 HTML 测试文件，包含针对 Issue #24 及混合语言场景的测试用例。 |

### 3. AI 生成声明与风险提示 (AI Disclaimer)
> **给 Reviewer 的重要提示**：
> 本次提交的代码由 AI 助手根据文档生成。**请勿假设代码逻辑正确。**

你需要重点审查以下潜在风险点（基于本次修改的逻辑分析）：
- [ ] **启发式逻辑误判**：检查 `(isCJKDetectedForSelection && /[a-zA-Z]/.test(sanitizedText))` 这一判断条件是否过于宽泛。例如，是否会导致包含单位符号（如 "50km"）的中文短语被错误识别为英文？
- [ ] **语言检测准确性**：`selectionLang` 仅依赖简短的选中特定的文本，对于非常短的片段（如单个单词或字符），`detectSourceLanguageAsync` 的准确性可能下降，需验证 fallback 逻辑。
- [ ] **副作用**：检查将 `selectionLang` 传递给 `translateFragmentPath` 和 `translateWordPath` 是否影响了纯 CJK 文本的正常翻译流程（尽管逻辑上旨在兼容）。
