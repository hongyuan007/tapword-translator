other/方案/26年/2月/02-dark-mode-issue/review/manifest_DarkModeFix_20260225.md

---

### 1. 变更背景 (Context)
- **关联文档**：
  - `other/方案/26年/2月/02-dark-mode-issue/README.md` (问题描述)
  - `other/方案/26年/2月/02-dark-mode-issue/260225-dark-mode-tooltip-contrast-fix-plan.md` (技术方案)
- **任务目标**：
  - 试图修复在深色模式网页（如 Nuxt 文档）上，翻译悬浮窗（Tooltip）文字颜色错误计算为黑色导致不可见的问题。

### 2. 文件变更审计 (Change Audit)
| 文件路径 | 变更类型 | 客观变更描述 (Objective Description) |
| :--- | :--- | :--- |
| `src/1_content/utils/styleCalculator.ts` | Mod | 移除原有的基于前景文字亮度的颜色计算逻辑；新增 `getEffectiveBackgroundColor` 方法以向上遍历 DOM 获取有效背景色；新增 `compositeForegroundOverBackground` 处理半透明背景叠加；改用 `calculateContrastRatio` (WCAG) 对比度算法决定文字颜色；新增 `isDarkThemeContext` 作为兜底策略（检测 `dark` 类名或 `color-scheme`）。 |

### 3. AI 生成声明与风险提示 (AI Disclaimer)
> **给 Reviewer 的重要提示**：
> 本次提交的代码由 AI 助手根据文档生成。**请勿假设代码逻辑正确。**

你需要重点审查以下潜在风险点（基于本次修改的逻辑分析）：
- [ ] **逻辑一致性**：`styleCalculator.ts` 中的背景色遍历逻辑 `collectBackgroundLayers` 设定了停止条件，但需确认在复杂的层叠上下文（Stacking Context）或 `fixed` 定位元素下，是否能正确获取视觉上的真实背景色。
- [ ] **副作用**：检查 `getEffectiveBackgroundColor` 递归/循环遍历父元素的操作，在深层 DOM 结构页面上是否存在性能隐患（尽管已隐式限制在 DOM 树路径上）。
- [ ] **边界情况**：`compositeForegroundOverBackground` 函数中的 Alpha 混合算法假设标准 RGB 混合，需确认在极端透明度（如 alpha=0）或非 sRGB 颜色空间下的表现是否符合预期。
- [ ] **兜底策略准确性**：`isDarkThemeContext` 仅检查了 `<html>` 标签的 `class="dark"` 或 computed style `color-scheme`，对于通过 `<body>` 或特定容器设置深色模式的网站可能无效。