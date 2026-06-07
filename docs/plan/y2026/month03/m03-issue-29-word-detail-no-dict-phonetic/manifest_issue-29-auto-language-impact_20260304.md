# 代码变更交付清单

### 1. 变更背景 (Context)
- **关联文档**：
  - `docs/plan/y2026/m03-issue-29-word-detail-no-dict-phonetic/README.md` (Issue #29 分析)
  - `docs/plan/y2026/m03-issue-29-word-detail-no-dict-phonetic/BACKEND_ISSUE_REPORT.md` (后端问题报告)
- **任务目标**：
  - 试图优化前端在 `sourceLanguage="auto"` (混合语言) 场景下的 UI 表现。
  - 具体目标：在不修改 `translationModal.ts` (由后端处理 TTS) 的前提下，确保词典标题（如“英汉词典”）能根据文本特征准确显示，并提取通用文本工具函数。

### 2. 文件变更审计 (Change Audit)
| 文件路径 | 变更类型 | 客观变更描述 (Objective Description) |
| :--- | :--- | :--- |
| `src/0_common/utils/textUtils.ts` | New | 新增通用工具类，包含 `isSingleWord` (判定是否为英文单词) 和 `containsMeaningfulWords` (判定是否包含有效字符) 逻辑，与后端判定规则保持一致。 |
| `src/1_content/ui/modalTemplates.ts` | Mod | 1. 引入 `textUtils`；2. 移除本地冗余的 `containsMeaningfulWords`；3. 修改 `createDictionarySection` 逻辑：当源语言为 `"auto"` 时，通过 `isSingleWord` 检查文本内容，从而更准确地决定是否显示“英汉词典”标题。 |

### 3. AI 生成声明与风险提示 (AI Disclaimer)
> **给 Reviewer 的重要提示**：
> 本次提交的代码由 AI 助手根据文档生成。**请勿假设代码逻辑正确。**

你需要重点审查以下潜在风险点（基于本次修改的逻辑分析）：
- [ ] **TTS 降级风险**：本次提交**移除了**之前在 `translationModal.ts` 中的客户端转换逻辑。**Reviewer 必须确认后端已支持接收 `"auto"` 语言代码进行语音合成**，否则用户点击朗读将无响应或报错。
- [ ] **词典标题判定一致性**：`isSingleWord` 的正则表达式 `^[a-zA-Z]+(?:[-'][a-zA-Z]+)*$/i` 旨在模拟后端行为。需验证该正则是否能完美覆盖所有合法英文单词（如带连字符或撇号的情况），以及是否会误标非英文单词。
- [ ] **多语种词典扩展性**：目前逻辑假设 `auto` + `isSingleWord` + `target=zh` 必为“英汉词典”。若未来后端引入“日汉”单性词典，此逻辑将产生误标。需评估是否在后端响应中增加明确的 `dictionaryType` 字段。
- [ ] **工具类引用**：检查 `textUtils.ts` 是否在构建流程中被正确处理（已加入 git staged），确保无引用错误。
