# 代码变更交付清单 (Code Change Manifest)

### 1. 变更背景 (Context)
- **关联文档**：`docs/plan/y2026/m02-issue-20-youtube-title-bug/README.md` (Issue #20: [BUG] youtube视频标题翻译，切换到下一个视频后，前一个视频的翻译没有消失)
- **任务目标**：试图解决在 YouTube 等 SPA 网站切换视频时，旧的翻译 DOM 残留导致与新标题重叠的问题。通过监听核心 URL 变化触发全局清理。

### 2. 文件变更审计 (Change Audit)
| 文件路径 | 变更类型 | 客观变更描述 (Objective Description) |
| :--- | :--- | :--- |
| `src/1_content/ui/translationDisplay.ts` | Mod | 新增 `removeAllTranslationResults` 导出函数，用于强制清理所有已追踪和未追踪的翻译 DOM 及 Tooltip；新增 DOM 解包工具函数。 |
| `src/1_content/handlers/SpaNavigationHandler.ts` | New | 创建新模块。实现了基于 `<head>` 变动 (`MutationObserver`) 和 `popstate` 事件的 SPA 导航检测逻辑；实现了忽略 Hash 变化的 URL 比对逻辑。 |
| `src/1_content/index.ts` | Mod | 移除了原有的导航检测代码，替换为调用 `SpaNavigationHandler.setup()`。 |

### 3. AI 生成声明与风险提示 (AI Disclaimer)
> **给 Reviewer 的重要提示**：
> 本次提交的代码由 AI 助手根据文档生成。**请勿假设代码逻辑正确。**

你需要重点审查以下潜在风险点（基于本次修改的逻辑分析）：
- [ ] **逻辑一致性**：`getCoreUrl` 函数仅保留 `origin + pathname + search`，请验证这是否涵盖了所有 YouTube 视频切换场景，且确实排除了所有仅修改 Hash 的锚点跳转。
- [ ] **副作用**：`removeAllTranslationResults` 中的 `removeUntrackedAnchorElements` 会遍历 DOM 查找残留元素，请评估在大型页面上的性能影响。
- [ ] **竞态条件**：SPA 框架（如 Angular/React）更新 DOM 的时机与 `MutationObserver` 触发的时机可能存在微小差异，需验证清理操作是否会在新内容渲染前正确执行，或者是否会误删新渲染的内容（虽然逻辑是清理旧的）。
- [ ] **兼容性**：`MutationObserver` 监听整个 `<head>` 的 `subtree`，在某些频繁修改 head 属性的网站上是否会触发过度频繁的检查（虽然有 URL 变更锁 `lastNavigationUrl`）。
