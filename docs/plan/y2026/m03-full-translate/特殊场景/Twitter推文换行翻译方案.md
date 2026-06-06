# 特殊场景：Twitter (X.com) 推文正文强制换行翻译方案

**Date**: 2026-03-19
**Status**: Proposal
**Scope**: `tapword-translator` 客户端 (`src/11_full_translate`)

## 1. 问题描述 (Problem)

在 Twitter (X.com) 网站上，单条推文的正文内容通常被包裹在 `<span>` 标签内。

例如，一段真实的推文 HTML 结构如下：

```html
<div class="css-175oi2r" data-tapword-block-node>
  <div class="css-146c3p1..." id="id__7oq63fovxr5" data-testid="tweetText" data-tapword-paragraph data-tapword-block-node>
    <span class="css-1jxf684..." data-tapword-paragraph data-tapword-inline-node>
      Every man can relate to this scenario
      <!-- 当前的内联翻译结果 -->
      <span class="notranslate tapword-translated-content-wrapper" data-tw-mode="bilingual" ...>
        <span>  </span>
        <span class="notranslate tapword-translated-inline-content">每个人都能理解这个场景</span>
      </span>
    </span>
  </div>
</div>
```

**现象**：
由于推文内容是被 `<span>` 标签包裹的，TapWord 的 DOM Walker 算法会根据其内联属性（Inline）将其标记为 `data-tapword-inline-node`。
在最终渲染翻译时（`src/11_full_translate/dom/renderer.ts`），渲染器检测到 `INLINE_ATTRIBUTE`，会采用双空格的“内联插入”方式（Inline Insertion），导致译文紧跟在英文原文后面，而不是换行显示。

**用户期望**：
对于推文这种独立的内容块，即使底层使用了 `<span>` 标签，用户在视觉上也期望译文能**换行显示在原文下方**，以获得更好的阅读体验。

## 2. 解决方案 (Solution)

为了不破坏全局的基础排版判定逻辑（即 `<span>` 默认视为内联元素，以保证维基百科等普通网页的正确排版），我们应当利用 `src/11_full_translate` 模块已经预留好的**站点级强制块级规则（Custom Force Block Selectors）**。

### 2.1 修改目标
文件：`src/11_full_translate/constants/index.ts`

在 `CUSTOM_FORCE_BLOCK_SELECTORS` 常量中，新增针对 `x.com` 和 `twitter.com` 的 CSS 选择器规则，精确命中推文正文的 `<span>` 标签。

### 2.2 具体代码变更

```typescript
// Site-specific selectors for elements that should force block translation style.
// Keys are base domains; filter.ts matches via hostname suffix.
export const CUSTOM_FORCE_BLOCK_SELECTORS: Record<string, string[]> = {
    "github.com": ["task-lists"],
    "youtube.com": ["yt-attributed-string > span"],
    
    // [新增] 强制 Twitter 推文正文的 span 按块级(Block)处理，以实现换行翻译
    "x.com": ["[data-testid=\"tweetText\"] span"],
    "twitter.com": ["[data-testid=\"tweetText\"] span"],
};
```

### 2.3 原理解释

1. **DOM Walker 阶段**：当算法遍历到推文正文的 `<span>` 时，`isCustomForceBlockTranslation` 函数会检查其是否匹配上述新增的 CSS 选择器（`[data-testid="tweetText"] span`）。
2. **强制标记**：一旦匹配，即使它是 `<span>` 且 `display` 表现为内联，Walker 也会强制给它打上 `data-tapword-block-node` 标记。
3. **渲染阶段**：在插入翻译时，`shouldUseInlineInsertion` 函数检测到该元素带有 `BLOCK_ATTRIBUTE`（且不在强制内联白名单内），将返回 `false`。
4. **最终效果**：渲染器改用“块级插入”策略（Block Insertion），在译文前插入 `<br>` 标签，并应用 `.tapword-translated-block-content` 样式，完美实现换行显示。

## 3. 方案优势 (Advantages)

- **零侵入性**：完全不修改核心的 DOM Walker 和 Renderer 算法，避免对其他网站的排版造成不可预期的破坏。
- **高精准度**：利用 Twitter 官方用于自动测试的稳定属性 `data-testid="tweetText"`，选择器不易因为 UI 迭代而失效。
- **符合架构设计**：完美契合了现有的站点级规则（Site-specific overrides）扩展机制。