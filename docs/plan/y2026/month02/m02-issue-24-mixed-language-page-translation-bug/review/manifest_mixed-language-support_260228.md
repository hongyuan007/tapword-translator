
### 1. 变更背景 (Context)
- **关联文档**:
  - `docs/plan/y2026/m02-issue-24-mixed-language-page-translation-bug/proposal_mixed_language_support.md` (技术方案)
  - `docs/plan/y2026/m02-issue-24-mixed-language-page-translation-bug/backend_api_requirements_mixed_language.md` (后端需求)
- **任务目标**:
  - 试图解决 Issue #24（中文页面选中英文单词被误判导致翻译错误）以及混合语言短语（如 "you什么时候来"）的翻译问题。
  - 引入 `"auto"` (Auto-Detect) 作为特定的源语言类型，用于指示后端 LLM 处理混合语言或代码切换（Code-Switching）场景，并绕过前端的同语言 Fallback 逻辑。

### 2. 文件变更审计 (Change Audit)
| 文件路径 | 变更类型 | 客观变更描述 (Objective Description) |
| :--- | :--- | :--- |
| `src/1_content/handlers/TranslationPipeline.ts` | Mod | 修改了 `processTranslation` 中的语言判定逻辑。当检测到 CJK 文本中包含拉丁字母（`/[a-zA-Z]/`）时，强制将 `selectionLang` 设置为 `"auto"`。 |
| `src/1_content/utils/languageDetector.ts` | Mod | 修改了 `resolveTargetLanguage` 函数。增加了对 `sourceLanguage === "auto"` 的检查，若匹配则直接返回目标语言，跳过后续的同语言 Fallback（如 zh->zh 自动转 en）逻辑。 |
| `src/8_generate/utils/languageUtils.ts` | Mod | 在 `LANGUAGE_NAMES` 映射中增加了 `auto: "Auto-Detect"`，用于本地 LLM 生成 Prompt 时提供语言名称。 |
| `tests/html/mixed_language_scenarios.html` | New | 创建了包含混合语言场景（如中文语境下的英文单词、中英混合短语）的 HTML 测试文件。 |
| `docs/plan/.../proposal_mixed_language_support.md` | Mod | 更新方案文档，将原计划的 `"mixed"` 关键词替换为 `"auto"`。 |
| `docs/plan/.../backend_api_requirements_mixed_language.md` | Mod | 更新后端需求文档，将原计划的 `"mixed"` 关键词替换为 `"auto"`。 |

### 3. AI 生成声明与风险提示 (AI Disclaimer)
> **给 Reviewer 的重要提示**：
> 本次提交的代码由 AI 助手根据文档生成。**请勿假设代码逻辑正确。**

你需要重点审查以下潜在风险点（基于本次修改的逻辑分析）：
- [ ] **启发式检测过于激进**：`TranslationPipeline.ts` 中使用 `/[a-zA-Z]/` 正则来判定 `"auto"` 模式。这可能导致仅包含少量字母的中文词汇（如 "T恤"、"A股"、"50km"）被标记为 `"auto"`。虽然逻辑上旨在交给 LLM 处理，但需验证 LLM 在 `Source="auto", Target="zh"` 时处理纯中文（带字母）输入的表现。
- [ ] **后端兼容性**：前端现在会发送 `sourceLanguage: "auto"`。必须确认后端 API 和 LLM Prompt 能够正确处理此值，而不是将其视为非法参数或默认回退到英文。
- [ ] **Fallback 逻辑变更**：`languageDetector.ts` 中跳过 Fallback 的逻辑是基于“相信 LLM 能处理混合输入”的假设。如果用户在纯英文页面选中纯英文（但误判为 auto），且目标语言为英文，跳过 Fallback 将导致 En->En 的翻译请求，需确认 LLM 是否会输出释义而非原文。

