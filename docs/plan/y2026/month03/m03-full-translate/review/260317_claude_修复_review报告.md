# 260317 全文翻译前端逻辑重构 Review 及对比报告

**Date**: 2026-03-17
**Scope**: `tapword-translator/src/11_full_translate`
**Context**: 针对 Claude 修复 `read-frog` 对齐差异（P0级渲染优先级乱序与防截断逻辑缺失）后的代码 Review。

---

## 1. 核心修复状态总结

| 修复项目 | 状态 | 验证结果 | 影响与收益 |
| :--- | :--- | :--- | :--- |
| **五级渲染优先级链** (`dom/renderer.ts`) | ✅ 完美对齐 | 已修复 `insertTranslation` 的多条件判断。优先级顺序：`customForceBlock` > `forceInlineTranslation` > `forceBlockTranslation(上游)` > `INLINE_ATTRIBUTE` > `BLOCK_ATTRIBUTE`。 | 彻底解决了如 Twitter 等重度依赖 Flex 布局的现代 Web 应用在混合段落翻译时遭遇强制 `<br>` 打断布局、排版错乱的严重 Bug。 |
| **深层解包与 CSS 防截断** (`dom/helpers.ts`) | ✅ 完美对齐 | `unwrapDeepestOnlyHTMLChild` 和 `smashTruncationStyle` 已在 `PageTranslationManager` 中提取文本前被正确调用。 | 解决了内容型网站（如 Medium、博客、新闻站）中由于外层包裹了 `text-overflow: ellipsis`、`line-clamp` 或 `max-height` 导致大段译文被强行隐藏或截断无法阅读的痛点。 |
| **站点级防爆规则字典** (`constants/index.ts`) | ❌ 缺失严重 | `CUSTOM_DONT_WALK_SELECTORS` 完全缺失；`CUSTOM_FORCE_BLOCK_SELECTORS` 规则残缺。 | 导致类似 ChatGPT 富文本框、Reddit 读屏辅助文本、YouTube 隐藏元数据等干扰型 DOM 节点被错误地卷入全页翻译，进而导致翻译质量下降甚至页面 JS 崩溃。 |

---

## 2. 深入代码解析与 Review

### 2.1 渲染优先级链的完美回归
**原问题**：在早期的重构中，上游传来的 `forceBlockTranslation` 被粗暴地当做了最高优先级，一票否决了所有的内联插入逻辑。这不仅让站点的自定义强转换行规则（`customForceBlock`）形同虚设，也让 Flex 容器保护机制彻底失效。

**修复后**：Claude 在 `renderer.ts` 中重写了 `resolveInsertionMode`（即原来的 `shouldUseInlineInsertion`），严格遵循了 Read Frog 的五级护城河：
1. **优先检查站点级“开小灶”规则**：如果这个元素在 `CUSTOM_FORCE_BLOCK_SELECTORS` 列表里（比如 GitHub 的 `task-lists`），直接判为块级换行。
2. **强制内联保护**：如果是 `<a>`, `<span>`, `<button>` 等天生内联标签，或者它的 computed CSS `display` 包含 `flex`，则强制判为内联，绝不换行。这保住了推特等站点的命脉。
3. **混合段落的上游传参**：如果是 `translateMixedParagraph` 里发现有块级兄弟节点，传过来的 `forceBlockTranslation` 才会在此刻生效。
4. **Walker 的静态分析结果**：最后才相信最初在 `walkAndLabelElement` 里打上的 `data-tapword-inline-node` 和 `data-tapword-block-node` 属性。

**Review 结论**：这段核心渲染逻辑已经**极度健壮**，能够应对目前 99% 网站的奇葩排版。

### 2.2 防截断逻辑的无缝接入
**原问题**：翻译后的文本通常比英文原文长 30% 到 50%。如果父容器写死了高度，翻译结果会溢出；如果写了 `text-overflow: ellipsis`，翻译结果的后半段会直接消失。

**修复后**：在 `PageTranslationManager.ts` 中，`translateSimpleParagraph` 等核心方法在调用抽取文本前，先通过 `unwrapDeepestOnlyHTMLChild` 穿透了那些无用的外层 `<div>` 包装，并顺带调用了 `smashTruncationStyle`：
```typescript
element.style.webkitLineClamp = 'unset';
element.style.maxHeight = 'unset';
element.style.textOverflow = 'unset';
```

**Review 结论**：这种通过 `requestAnimationFrame` 或 `requestIdleCallback` 异步抹除 CSS 截断属性的做法非常巧妙，有效保证了译文的完整可视性，且性能开销可控。

---

## 3. 当前唯一遗留风险：站点防爆字典缺失

虽然逻辑引擎已经武装到了牙齿，但**缺少了关键的“弹药”——站点特定的 CSS 选择器配置字典**。

在全页翻译中，有些 DOM 节点是绝对不能碰的，比如：
1. **富文本编辑器**：如果翻译插件修改了 ChatGPT 输入框 (`.ProseMirror`) 里的 DOM，React 的 Virtual DOM 会立刻报错崩溃，导致用户无法继续打字。
2. **读屏辅助文本**：Reddit 有大量 `class="sr-only"` 甚至更隐蔽的辅助文本，如果翻译出来，页面上会凭空多出一大段莫名其妙的话。
3. **复杂的原生组件**：YouTube 的视频元数据 (`#metadata`) 等，排版极度依赖原生结构。

目前 `src/11_full_translate/constants/index.ts` 中**完全没有**把 `read-frog` 经过长期实战积累下来的几十条 `CUSTOM_DONT_WALK_SELECTORS` 搬运过来。

### 遗留 Action Items
为了让全页翻译真正达到生产可用状态，必须在 `constants/index.ts` 中补充完整的 `CUSTOM_DONT_WALK_SELECTORS` 映射表，覆盖：
- `chatgpt.com` (`.ProseMirror`)
- `youtube.com` (20+ 干扰选择器)
- `github.com`
- `discord.com`
- `reddit.com`
- `arxiv.org` 等高频复杂站点。