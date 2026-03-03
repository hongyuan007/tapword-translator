# Code Change Manifest: StyleCalculator Refactor

### 1. 变更背景 (Context)
- **关联任务**：遵循 `docs/prompt_files/refactor/refactor-single-file.prompt.md` 规则对 `src/1_content/utils/styleCalculator.ts` 进行重构。
- **任务目标**：将庞大的单文件工具类拆分为职责单一的子模块，同时保持原有对外的 API 签名不变（Orchestrator Pattern），以提升代码的可读性和可维护性。同时更新了重构规则文档以反映最佳实践。

### 2. 文件变更审计 (Change Audit)
| 文件路径 | 变更类型 | 客观变更描述 (Objective Description) |
| :--- | :--- | :--- |
| `src/1_content/utils/styleCalculator.ts` | Refactor | 移除了原有实现逻辑，改为从子模块导入并重新组装 `calculateTooltipStyle` 函数，充当 Orchestrator。保留了对外导出的接口签名。 |
| `src/1_content/utils/styleCalculator/types.ts` | New | 新增文件。定义了 `RgbaColor`, `SpaceCalculation`, `TooltipStyle` 等共享接口。 |
| `src/1_content/utils/styleCalculator/colors.ts` | New | 新增文件。包含纯数学计算的颜色处理函数 (`parseColor`, `compositeForegroundOverBackground` 等)。 |
| `src/1_content/utils/styleCalculator/dom.ts` | New | 新增文件。包含依赖 DOM 的颜色获取逻辑 (`getEffectiveBackgroundColor`, `isDarkThemeContext`)。 |
| `src/1_content/utils/styleCalculator/layout.ts` | New | 新增文件。包含字体大小和布局计算逻辑 (`calculateOptimalTranslationFontSize`)。 |


### 3. AI 生成声明与风险提示 (AI Disclaimer)
> **给 Reviewer 的重要提示**：
> 本次提交的代码由 AI 助手根据文档生成。**请勿假设代码逻辑正确。**

你需要重点审查以下潜在风险点（基于本次修改的逻辑分析）：
- [ ] **逻辑完整性**：拆分后的子函数 (`colors.ts`, `dom.ts`, `layout.ts`) 是否完整保留了原有的所有逻辑细节（包括魔法数值、特殊判断），没有遗漏。
- [ ] **API 兼容性**：`styleCalculator.ts` 重新导出的函数签名是否与原文件完全一致，确保未破坏外部调用（如 `content/index.ts` 等）。
- [ ] **引用正确性**：检查子模块之间的引用关系是否正确，是否存在循环依赖。
- [ ] **构建验证**：虽然已运行 `npm run type-check` 通过，但建议进行运行时测试，确认 Tooltip 的样式计算（颜色对比度、字体大小调整）在实际网页中表现正常。
