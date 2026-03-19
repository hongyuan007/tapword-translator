# 特殊场景：Twitter (X.com) 推文正文换行翻译方案（通用规则版）

**Date**: 2026-03-19
**Status**: Proposal
**Scope**: `tapword-translator` 客户端 `src/11_full_translate`

## 1. 问题描述

当前 X.com 推文正文有时会被翻译成“原文后面直接追加译文”，而不是“译文换行显示在原文下方”。

典型 HTML 结构如下：

```html
<div data-testid="tweetText" data-tapword-paragraph data-tapword-block-node>
  <span data-tapword-paragraph data-tapword-inline-node>
    Every man can relate to this scenario
    <span class="notranslate tapword-translated-content-wrapper">
      <span>  </span>
      <span class="notranslate tapword-translated-inline-content">
        每个人都能理解这个场景
      </span>
    </span>
  </span>
</div>
```

从结果可以看出，译文被插入到了内部 `span`，并且采用了 inline insertion。

## 2. 根因分析

### 2.1 不是站点特判缺失，而是插入目标选错了

当前 simple paragraph 路径在真正插入译文前，会先调用：

- [helpers.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/dom/helpers.ts) 中的 `unwrapDeepestOnlyHTMLChild()`

这段逻辑会不断向下钻：

1. 如果当前元素只有一个“有效 HTML 子节点”
2. 且没有并列文本节点
3. 就把当前插入目标切换为那个唯一子元素

对于推文正文这类结构：

```html
<div data-testid="tweetText" ...>
  <span>Tweet text</span>
</div>
```

外层 `div` 是视觉上的正文容器，但因为它只有一个有效子元素 `span`，算法会继续下钻，最终把翻译插入目标变成这个 `span`。

### 2.2 一旦目标变成 `span`，渲染器就会优先判成 inline

插入逻辑在：

- [renderer.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/dom/renderer.ts)

其中 `shouldUseInlineInsertion()` 的优先级是：

1. `FORCE_INLINE_TRANSLATION_TAGS` 命中则 inline
2. 有 `INLINE_ATTRIBUTE` 则 inline
3. 有 `BLOCK_ATTRIBUTE` 则 block
4. 否则根据 `display` 决定

因此，推文正文一旦被下钻到 `span`：

- 元素标签是 `SPAN`
- 往往还带有 `data-tapword-inline-node`

最终就会稳定走 inline insertion，表现为：

```html
<span>  </span>
<span class="tapword-translated-inline-content">...</span>
```

而不是：

```html
<br>
<span class="tapword-translated-block-content">...</span>
```

## 3. 用户期望

用户真正需要的不是“Twitter 站点特殊处理”，而是更合理的通用语义：

- 正文内容块：译文应优先换行显示
- 按钮、短标签、控件文案：译文才适合直接接在原文后面

也就是说，应该区分：

- **content container**
- **inline text leaf**

当前实现过早把很多正文容器降级成了 inline text leaf。

## 4. 方案目标

不重新引入站点级硬编码规则，不依赖 `x.com` / `twitter.com` 选择器，而是修改通用规则：

1. 让正文块尽量保留 block 容器作为插入目标
2. 只有明确的小型 inline 场景才下钻
3. 按钮、选项、短控件文本继续允许 inline insertion

## 5. 建议方案

### 5.1 修改点

文件：

- [helpers.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/dom/helpers.ts)

函数：

- `unwrapDeepestOnlyHTMLChild()`

### 5.2 核心思路

当前逻辑是：

- 只要只有一个有效 HTML child，就继续下钻

建议改成：

- 只有在“当前节点本身也更像 inline wrapper / neutral wrapper”时，才继续下钻
- 如果当前节点已经是 block paragraph container，就停止下钻，保留它作为最终插入目标

### 5.3 判断原则

可采用以下通用规则组合：

#### 规则 A：当前节点已经是 block paragraph 时，不再下钻

如果当前元素满足以下任一条件，则直接停止：

- 带有 `data-tapword-block-node`
- 或者不是 `data-tapword-inline-node`
- 或者其 `computedStyle.display` 明显是 block-like

这样像：

```html
<div data-testid="tweetText" data-tapword-block-node>
  <span>...</span>
</div>
```

会保留 `div` 作为插入目标，最后自然走 block insertion。

#### 规则 B：只有“纯包装 inline 容器”才允许继续下钻

例如：

- `span > span`
- 没有独立块级语义
- 没有 block 标记
- display 为 inline / inline-block / contents

这类节点才适合继续下钻。

#### 规则 C：按钮/控件场景继续由 renderer 决定 inline

像下面这些保留原逻辑即可：

- `BUTTON`
- `A`
- `OPTION`
- `SELECT`
- 其他明确 UI 控件文本

这些场景本来就不适合强制换行。

## 6. 推荐实现方向

### 方案一：只改 `unwrapDeepestOnlyHTMLChild()`，优先推荐

优点：

- 影响面集中
- 不引入站点特判
- 贴合真正根因
- 对现有 renderer 判定逻辑侵入最小

建议在该函数中增加一个“是否允许继续下钻”的判断，例如：

```typescript
function shouldKeepCurrentElementAsInsertionTarget(element: HTMLElement): boolean {
    if (element.hasAttribute(BLOCK_ATTRIBUTE)) return true;
    if (!element.hasAttribute(INLINE_ATTRIBUTE)) return true;

    const display = window.getComputedStyle(element).display;
    return !display.startsWith('inline') && display !== 'contents';
}
```

然后在 `unwrapDeepestOnlyHTMLChild()` 中：

- 如果当前节点应该保留为插入目标，则停止下钻

### 方案二：在 renderer 中额外补判，不推荐作为首选

例如在 `shouldUseInlineInsertion()` 里增加更多上下文判断。

缺点：

- 只能改变“插入样式”
- 不能修正“插入目标已经选错”的问题
- 逻辑会比修改 helper 更绕

因此不推荐把 renderer 作为主要修复点。

## 7. 为什么不建议使用站点级选择器方案

Gemini 方案建议重新引入类似：

```typescript
"x.com": ["[data-testid=\"tweetText\"] span"]
```

的问题在于：

1. 它重新引入了站点硬编码
2. 它只修 Twitter 当前结构，不修同类问题
3. 相同问题可能出现在其他网站的“block container > single span”正文结构
4. 后续规则会越堆越多，回到之前那种不可维护状态

因此这个问题更适合定义成“通用 DOM 目标选择错误”，而不是“Twitter 特例”。

## 8. 预期效果

修复后：

- Twitter 推文正文：译文换行
- 普通正文段落：维持换行
- 按钮/小控件/短标签：继续 inline
- 不需要重新引入 hostname / selector 特判

## 9. 建议补充日志

如果需要验证该方案，可临时增加 debug 日志，记录：

- 原始 paragraph element
- unwrap 前元素标签
- unwrap 后目标标签
- 最终 `useInline` 判定结果
- 判定原因

建议位置：

- [helpers.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/dom/helpers.ts)
- [renderer.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/dom/renderer.ts)

## 10. 结论

本问题的本质不是“Twitter 需要特殊站点规则”，而是：

**simple paragraph 路径把 block-level content container 过度下钻成了 inline leaf，导致 renderer 做出了错误但可解释的 inline insertion 决策。**

因此，推荐方案是：

- 修改通用的 insertion target selection 规则
- 保留现有按钮/控件类 inline 行为
- 不恢复站点级硬编码机制
