# 代码变更交付清单：Issue #24 混合语言页面翻译优化

### 1. 变更背景 (Context)
- **关联文档**：Issue #24: mixed-language page translation
- **任务目标**：
    - 试图解决在混合语言页面（如中文句子中包含英文单词）中，语言检测器误报的问题（例如英文单词 "having" 被识别为韩语）。
    - 试图优化选区扩展逻辑，防止双击英文单词（如 "App"）时，选区错误扩展并吞并相邻的中文字符（如 "App的体验"）。

### 2. 文件变更审计 (Change Audit)

| 文件路径 | 变更类型 | 客观变更描述 (Objective Description) |
| :--- | :--- | :--- |
| `src/1_content/utils/languageDetector.ts` | Mod | 增加 `hasCJKCharacters` 工具函数；在 `detectSourceLanguageAsync` 中增加了对检测结果的校验逻辑，若检测结果为 CJK 语言但文本不包含 CJK 字符，则回退为默认行为，旨在修复短英文单词误报为 CJK 语言的问题。 |
| `src/1_content/handlers/utils/selectionClassifier.ts` | Mod | 修改了 `WORD_BOUNDARY_REGEX` 正则表达式，增加了 CJK Unicode 范围 (`\u4e00-\u9fff` 等)，使其将 CJK 字符视为单词边界。 |
| `src/1_content/handlers/utils/rangeAdjuster.ts` | Mod | 同步修改了 `WORD_BOUNDARY_REGEX` 正则表达式，包含 CJK Unicode 范围，旨在确保 `expandToWordBoundaries` 在遇到 CJK 字符时停止扩展。 |
| `tests/1_content/utils/rangeAdjuster.test.ts` | Fix | 修正了 import 路径，将 `@/1_content/utils/rangeAdjuster` 更新为 `@/1_content/handlers/utils/rangeAdjuster` 以解决测试运行时的模块解析错误。 |

### 3. AI 生成声明与风险提示 (AI Disclaimer)
> **给 Reviewer 的重要提示**：
> 本次提交的代码由 AI 助手根据文档生成。**请勿假设代码逻辑正确。**

你需要重点审查以下潜在风险点（基于本次修改的逻辑分析）：
- [ ] **正则覆盖范围**：`WORD_BOUNDARY_REGEX` 中添加的 CJK Unicode 范围是否完整？是否涵盖了所有常见的 CJK 标点或变体字符？如果遗漏某些范围，可能导致边界判断失效。
- [ ] **语言检测副作用**：`languageDetector.ts` 中的强制 CJK 字符检查是否会误伤某些极短的、不包含汉字但属于 CJK 语系的特殊输入（虽然概率极低）？
- [ ] **选区扩展一致性**：检查 `selectionClassifier.ts` 和 `rangeAdjuster.ts` 中的正则是否保持完全一致，避免因正则不同步导致分类与调整逻辑冲突。
- [ ] **测试覆盖率**：虽然修复了 `rangeAdjuster` 的测试路径，但针对新的 CJK 边界逻辑，是否需要补充专门的单元测试用例以验证 "App的" 这种混合边界情况？
