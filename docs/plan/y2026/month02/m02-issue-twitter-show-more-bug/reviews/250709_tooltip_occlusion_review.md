# Review Report — Tooltip Occlusion Visibility

**Manifest**: `manifest__tooltip-occlusion-visibility_2026-03-13.md`  
**Date**: 2025-07-09  
**Scope**: `clipVisibility.ts` (Mod), `translationDisplayV2.ts` (Mod), `hitTesting.ts` (Mod)

---

## 🛡️ Review Summary

本次变更在已有的 clip-chain 可见性检查基础上，新增了基于 `elementFromPoint()` 的 **overlay 遮挡检测**，使 tooltip 在源文本被宿主页面下拉菜单/弹窗覆盖时自动隐藏。同时新增 **post-click MutationObserver** 在 4 秒观测窗口内重新计算可见性，以捕获异步弹出的 popover。架构和逻辑总体合理，hit testing 与 rendering 共用同一个 `isRectVisibleForSource` 函数保证了行为一致性。

**`npm run type-check` 通过，无编译错误。**

---

## 🚨 CRITICAL / 🔴 HIGH ISSUES

**无。**

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### M1 — Performance: `findClippingAncestors` 每个 rect 重复计算 (Medium)

**文件**: `clipVisibility.ts` → `isRectVisibleForSource()`  
**位置**: 被 `translationDisplayV2.ts` L350 和 `hitTesting.ts` L222/L248 调用

`isRectVisibleForSource()` 内部每次调用都执行 `findClippingAncestors(sourceElement)`，该函数遍历整个 DOM 祖先链并调用 `getComputedStyle()`。但同一个 translation 的所有 rect 共享相同的 `sourceElement`，祖先链完全一致。

**影响**：
- `positionTooltip()` 中：N 个 rect → N 次相同的祖先链遍历
- Hit testing 中：range rects loop + gap bridging loop → 最多 2N 次
- 在滚动过程中每帧每个 translation 都会触发

**建议**：将 `findClippingAncestors` 的结果作为参数传入，或在 `isRectVisibleForSource` 中接受可选的 `clippingAncestors` 缓存参数：
```typescript
export function isRectVisibleForSource(
    rect: DOMRect,
    sourceElement: HTMLElement | null,
    range: Range,
    cachedClippingAncestors?: HTMLElement[]
): boolean {
    const clippingAncestors = cachedClippingAncestors ?? findClippingAncestors(sourceElement)
    // ...
}
```

---

### M2 — Performance: Interaction Observer 观测范围过宽 (Medium)

**文件**: `translationDisplayV2.ts` L131-148

```typescript
interactionObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: INTERACTION_ATTRIBUTE_FILTER,
})
```

在 4 秒窗口内观测整个 `document.body` 的子树变化。在 Twitter、Facebook 等动态页面上，DOM 变更可能每秒触发数百次。虽然 `scheduleReposition` 通过 `requestAnimationFrame` 做了节流（每帧最多一次），但每次 reposition 都对所有 translation 的每个 rect 执行 `elementFromPoint()`（每个 rect 5 个采样点）。

**最坏场景**：5 个 translation × 2 行 × 5 采样点 = 50 次 `elementFromPoint()` per frame，持续 4 秒。

**建议**：
- 考虑在 MutationObserver 回调中增加额外的 `requestAnimationFrame` 合并（目前 `scheduleInteractionReposition` 已用了双层 rAF，这是好的）
- 或限制 observer 范围（只观测 body 的直接子元素变化，因为 dropdown/popover 通常 append 在 body 下）：
```typescript
interactionObserver.observe(document.body, {
    childList: true,
    subtree: false,  // only direct children
    attributes: false,
})
```

---

## 💡 SUGGESTIONS

### L1 — Hit testing 中 visibility 重复检查

**文件**: `hitTesting.ts` L218-250

`isPointInsideTranslationZone()` 在 range rects loop 和 gap bridging loop 中各调用一次 `isRectVisibleForSource(rangeRect, ...)`，对同一个 `rangeRect` 执行了两次完整的遮挡检测。

可以预先计算 visibility 数组复用：
```typescript
const visibilityFlags = rangeRects.map(r => isRectVisibleForSource(r, sourceElement, range))
```

### L2 — `scheduleInteractionReposition` 无 early-out

**文件**: `translationDisplayV2.ts` L103-111

`handleInteractionVisibilityRefresh` 调用 `scheduleInteractionReposition()` 时不检查 `activeTranslations.size`（`startInteractionObserverWindow` 内有此检查，但 `scheduleInteractionReposition` 没有）。可以在入口处加 guard 避免无意义的 rAF 调度。

### L3 — Occlusion sampling 对超小 rect 的边界行为

**文件**: `clipVisibility.ts` L68-82

当 rect 极窄（width < 4px）时，`insetX = width/4` < 1px，5 个采样点基本重叠在同一像素位置。对于单个字符的选中（如 CJK 字符），这意味着整个 5-point 策略退化为 1-point。实际影响很小，因为这种 rect 被遮挡的概率和可见的概率都是全覆盖或全不覆盖，但值得在注释中说明。

### L4 — `isPointVisibleToSource` 中 `topElement.contains(sourceElement)` 的含义

**文件**: `clipVisibility.ts` L96

当 `elementFromPoint` 返回的是 sourceElement 的祖先元素（如 `<body>` 或 `<article>`）时，`topElement.contains(sourceElement)` 为 true → 视为可见。这在正常情况下是对的（没有 overlay 时，点击文本区域可能返回其容器元素）。但理论上，如果 sourceElement 的内容在视觉上不在该位置（如 CSS transform 或 absolute positioning 移走了子元素），`elementFromPoint` 返回的祖先 ≠ 源文本在该点可见。实际风险极低，仅在此记录。

---

## ✅ 确认的正面设计

1. **Clip-first, Occlusion-second**: `isRectVisibleForSource` 先检查 clip-chain，再做 occlusion sampling。clip 检查是纯几何运算（快），occlusion 用 `elementFromPoint`（慢）。短路逻辑正确。
2. **`.some()` 语义**：5 点采样中任一点可见 → rect 可见。偏向保守显示 tooltip，避免误隐藏。方向正确。
3. **Hit testing / Rendering 一致性**：两者共用 `isRectVisibleForSource`，不会出现 "能看到但点不到" 或 "点得到但看不到" 的不一致。
4. **Observer lifecycle 清理**：`stopInteractionObserver` 在超时、re-arm、detach 三条路径都正确断开和清理 timer。
5. **`sourceElement` null guard**：`isRectVisibleForSource` 在 `sourceElement` 为 null 时跳过 occlusion 检查、仅做 clip 检查。避免 NPE。
6. **`range.intersectsNode` 兜底**：处理了 Range 跨多元素的情况（如 `<em>word</em> text`），通过 try-catch 防御 detached range。

---

## 📊 结论

| 等级 | 数量 | 处理建议 |
|------|------|----------|
| Critical | 0 | — |
| High | 0 | — |
| Medium | 2 | M1 建议在下次重构时处理（简单的参数传递优化）；M2 可在实际观察到性能问题时收窄 observer 范围 |
| Low | 4 | 可选优化，不阻塞合并 |

**整体评估：代码质量良好，架构合理，无阻塞性问题。可合并。**
