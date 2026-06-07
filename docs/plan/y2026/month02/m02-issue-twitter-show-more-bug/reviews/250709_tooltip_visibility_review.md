# Tooltip Visibility Clip-Chain 代码审查报告

> 审查日期: 2026-03-13  
> 审查范围: `src/1_content/ui/translationDisplayV2.ts` 中关于 clip-chain visibility 的新增/修改代码  
> 参考文档: `manifest__tooltip-visibility-clip-chain_2026-03-13.md`

---

## 🛡️ Review Summary

本次变更在 `translationDisplayV2.ts` 中新增了三个辅助函数 (`isClippingOverflowValue`, `findClippingAncestors`, `rectIntersectsClipChain`) 和对 `positionTooltip()` 的修改，目的是在源文本被 overflow 容器裁剪时隐藏 tooltip，恢复 V1 的可见性行为。

**整体评价**: 设计方向正确——用 clip-chain 检测替代已移除的 `IntersectionObserver`。但实现存在一个**关键架构缺陷**：将 `visibleRects`（过滤后的可见行）直接替代 `lineRects` 来决定 tooltip segment 数量和文本分割，这会在滚动时导致 tooltip 数量抖动和文本重分配。此外，clip 检测启发式存在覆盖盲区，hit testing 与隐藏状态之间存在不一致。

`npm run type-check` 通过，无类型错误。

---

## 🚨 CRITICAL ISSUES

### C1: visibleRects 替代 lineRects 导致 tooltip 数量抖动 (Tooltip Count Churn)

**位置**: `translationDisplayV2.ts` L340 `const lineRects = visibleRects`

**问题描述**:

`positionTooltip()` 中：

```typescript
const rects = getNormalizedLineRects(entry.range)           // 全部行 rects
const visibleRects = rects.filter(...)                       // 过滤后的可见 rects
const lineRects = visibleRects                               // ← 问题根源
// ...
const desiredCount = Math.max(1, lineRects.length)           // segment 数量由 visibleRects 决定
const segments = ensureTooltipSegmentCount(id, desiredCount, baseTooltip)
```

当用户滚动页面时，某些源文本行会逐渐进出裁剪区域。由于 segment 数量由 `visibleRects.length` 决定：

1. **tooltip 元素频繁创建/销毁**: 例如 3 行文本，滚动后仅 2 行可见 → `ensureTooltipSegmentCount` 移除 1 个 tooltip 并重新分割文本。再滚回来 → 又创建 1 个 tooltip。每次裁剪边界变化都触发 DOM 操作。
2. **文本重分配**: 不同行的宽度不同，可见行集合变化 → `splitTextAcrossRects` 的 widths 参数变化 → 翻译文本在 segments 间重新分配 → 用户看到文字跳动。
3. **rect 签名频繁失效**: `buildRectsSignature(lineRects)` 基于可见行计算，每次裁剪状态变化都会产生新签名 → cache 失效 → 触发重分割。

**预期行为**: tooltip segment 数量应始终基于**全部** `rects`（完整行集合），不受裁剪影响。裁剪应仅控制各 segment 的 `visibility`，而非改变 segment 总数。

**修复方向**:

```typescript
const rects = getNormalizedLineRects(entry.range)         // 全部行
const lineRects = rects                                    // segment 数量和文本分割基于全部行
const visibleSet = new Set(
    rects.filter((r) => rectIntersectsClipChain(r, clippingAncestors))
)

if (visibleSet.size === 0) {
    for (const tooltip of entry.tooltips) tooltip.style.visibility = "hidden"
    return
}

// ... 正常定位逻辑 ...
// 在逐 segment 定位时，按行对应关系控制 visibility
for (let i = 0; i < segs.length; i++) {
    const rect = rects[i]
    const tooltip = segs[i]
    tooltip.style.visibility = visibleSet.has(rect) ? "visible" : "hidden"
    // ... 定位逻辑保持不变 ...
}
```

**严重程度**: 🚨 CRITICAL — 直接影响用户体验，多行翻译在滚动时会出现明显的视觉闪烁。

---

## 🔴 HIGH ISSUES

### H1: hit testing 对隐藏 tooltip 产生幽灵命中

**位置**: `hitTesting.ts` L200-220 (tooltip rect 命中检测)

**问题描述**:

当 tooltip 被 `visibility: hidden` 隐藏后，`getBoundingClientRect()` 仍返回有效尺寸（非零 width/height）。在 `isPointInsideTranslationZone` 中：

```typescript
// tooltip 虽然 hidden，但 rect 尺寸仍 > 0，会通过此检查
for (const tooltip of tooltips) {
    const rect = tooltip.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue  // ← 不会跳过 hidden tooltip
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return true  // ← 幽灵命中
    }
}
```

同样，`Range.getClientRects()` 返回的 rects 不受 overflow 裁剪影响——被裁剪的文本行仍会返回有效的 viewport 坐标。这意味着用户点击裁剪容器上方/下方的区域可能会匹配到被隐藏的翻译。

**实际风险**: 在完全裁剪（所有 tooltip hidden）的场景中，由于裁剪容器遮挡了被裁剪文本区域的点击，风险较低。但在部分裁剪场景中（C1 修复后的 per-segment visibility），某些 hidden segment 可能与可见内容重叠，导致错误的 modal 打开。

**修复方向**: hit testing 应跳过 `visibility: hidden` 的 tooltip，或在 range rect 命中测试中也应用 clip-chain 过滤。

---

### H2: `overflow: clip` 容器无法被检测

**位置**: `translationDisplayV2.ts` L271-282 (`findClippingAncestors`)

**问题描述**:

```typescript
const clipsHorizontally = isClippingOverflowValue(overflowX) && current.scrollWidth > current.clientWidth
const clipsVertically = isClippingOverflowValue(overflowY) && current.scrollHeight > current.clientHeight
```

`isClippingOverflowValue` 正确包含了 `"clip"` 值，但 `overflow: clip` 的特殊性在于它**不会创建滚动容器**。因此 `scrollWidth === clientWidth` 且 `scrollHeight === clientHeight` 始终成立，即使内容确实被裁剪了。

这意味着使用 `overflow: clip`（而非 `overflow: hidden`）的容器会被完全忽略。虽然 `overflow: clip` 使用率较低，但它是 CSS 规范推荐的现代替代方案，在新网站中逐渐增多。

**修复方向**: 对 `overflow: clip` 值，跳过 `scrollWidth/scrollHeight` 检查，直接将其视为裁剪祖先。

```typescript
const isClipValue = overflowX === "clip" || overflowY === "clip"
const clipsHorizontally = isClippingOverflowValue(overflowX) && current.scrollWidth > current.clientWidth
const clipsVertically = isClippingOverflowValue(overflowY) && current.scrollHeight > current.clientHeight

if (isClipValue || clipsHorizontally || clipsVertically) {
    ancestors.push(current)
}
```

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### A1: [设计] clipping ancestor 的锚点选择可能遗漏跨元素 Range

**位置**: `translationDisplayV2.ts` L329

```typescript
const sourceElement = entry.range.startContainer.parentElement
const clippingAncestors = findClippingAncestors(sourceElement)
```

当 Range 跨越多个 DOM 元素时（例如 `<span>text1</span><em>text2</em>`），`startContainer.parentElement` 仅返回第一个元素的父级。如果后续行的文本节点位于不同的裁剪容器层级中，这些容器不会被检测到。

**建议**: 对于跨元素 Range，可考虑使用 `range.commonAncestorContainer` 作为遍历起点，或对每行 rect 分别查找其对应的裁剪祖先。

### A2: [性能] scroll 路径上的 `getComputedStyle` 调用成本

**位置**: `findClippingAncestors` 内循环中的 `window.getComputedStyle(current)`

在 `scheduleReposition` 的 rAF 回调中，每个活跃翻译都会调用 `findClippingAncestors`，该函数对每个祖先节点调用 `getComputedStyle`。对于深层嵌套的页面（Twitter 通常有 15-20 层），如果有 N 个活跃翻译，每帧需要 N × depth 次 `getComputedStyle` 调用。

`getComputedStyle` 本身不一定触发 reflow（如果布局已计算），但 `scrollWidth` / `clientWidth` 的读取**会**触发布局计算。在滚动密集页面上，这可能导致肉眼可见的卡顿。

**建议**:
- 缓存 clipping ancestors 列表（DOM 结构不变时无需重新遍历）。仅在 MutationObserver 触发时刷新。
- `rectIntersectsClipChain` 中的 `getBoundingClientRect()` 是每帧必须执行的（因为滚动改变 viewport 坐标），但可以接受——它不触发 reflow。

### A3: [弹性] `overflow: hidden` 配合 CSS Transforms 的边缘场景

如果一个祖先使用 `overflow: hidden` 但 `scrollHeight === clientHeight`（内容未溢出），当前逻辑正确地跳过它。但如果该容器使用 CSS transforms 移动子元素出视口，裁剪确实发生了，却不会被检测到。

这是一个低概率边缘场景，但在动画效果较多的 SPA 页面中可能出现。当前阶段可以接受，但值得在后续迭代中关注。

### A4: [弹性] 与 orphan cleanup 无冲突 ✅

clip-chain 逻辑在 `positionTooltip()` 中位于 orphan 检查之后执行：

```typescript
if (!entry.range.startContainer.isConnected) {
    cleanupTranslationById(id, "orphan")
    return
}
// clip-chain 逻辑在此之后
```

当 SPA 导航导致 DOM 移除时，orphan 检查会先触发清理，clip-chain 逻辑不会在已断开的 Range 上执行。这是正确的执行顺序。

---

## 💡 SUGGESTIONS

### S1: 将 `isClippingOverflowValue` 提取为共享常量集合

当前使用字符串比较函数，可重构为 `Set` 以提高可读性和性能：

```typescript
const CLIPPING_OVERFLOW_VALUES = new Set(["hidden", "clip", "scroll", "auto"])

function isClippingOverflowValue(value: string): boolean {
    return CLIPPING_OVERFLOW_VALUES.has(value)
}
```

### S2: `rectIntersectsClipChain` 使用提前终止的命名更清晰

函数名 `rectIntersectsClipChain` 返回 `boolean`，但实际计算的是"rect 是否在所有裁剪祖先的交集中仍可见"。建议重命名为 `isRectVisibleInClipChain` 以更准确地表达语义。

### S3: 为裁剪检测逻辑添加单元测试

当前 manifest 确认没有运行自动化测试。建议为以下场景添加测试：
- 单层 overflow container 裁剪
- 多层嵌套 overflow container
- 部分行可见 / 全部行裁剪 / 全部行可见
- `overflow: clip` 场景（待 H2 修复后）

### S4: 考虑对 `visibility` 使用 `display: none` 替代方案

`visibility: hidden` 保留元素的占位空间，而 `display: none` 完全移除。对于 tooltip segment，`display: none` 可以避免 H1 中提到的幽灵命中问题（`getBoundingClientRect()` 返回零尺寸），但需要注意 `display` 切换会触发 reflow。在 tooltip 是 `position: absolute` 的情况下，reflow 影响很小，值得评估。

---

## 检查清单对照 (来自 Manifest Risk Items)

| # | 检查项 | 结果 | 备注 |
|---|--------|------|------|
| 1 | 源文本完全裁剪时隐藏是否正确 | ⚠️ 功能正确，但有副作用 | 全部隐藏逻辑正确 (L332-335)，但 C1 问题影响部分裁剪场景 |
| 2 | 至少一行可见时 tooltip 保持显示 | ⚠️ 有条件正确 | 当前是 all-or-nothing，C1 修复后应实现 per-segment visibility |
| 3 | 过滤后的 lineRects 是否导致 tooltip 数量抖动 | 🚨 是 | C1 详述 |
| 4 | 嵌套 overflow 容器是否处理 | ✅ 正确 | `findClippingAncestors` 遍历完整祖先链 |
| 5 | clip 检测启发式是否正确 | ⚠️ 部分正确 | H2: `overflow: clip` 遗漏 |
| 6 | 是否与 orphan cleanup 冲突 | ✅ 无冲突 | A4 确认 |
| 7 | hit testing 在 tooltip 隐藏时是否正确 | 🔴 有问题 | H1 详述 |
| 8 | 滚动性能是否可接受 | ⚠️ 需关注 | A2: getComputedStyle 调用密度较高 |
