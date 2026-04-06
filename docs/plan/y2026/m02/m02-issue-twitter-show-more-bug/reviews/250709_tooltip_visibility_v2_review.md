# Tooltip Visibility Clip-Chain V2 — Code Review Report

**日期**: 2026-03-13
**审查范围**: `translationDisplayV2.ts`, `hitTesting.ts`, `clipVisibility.ts`（新增）, `types.ts`
**审查依据**: `chrome-extension-review.prompt.md` + 上次审查遗留问题清单
**Type-check 结果**: `npm run type-check` 通过，无错误

---

## 🛡️ Review Summary

本次修订围绕三个目标：① 消除 tooltip 段数抖动（C1）、② 消除隐藏 tooltip 的幽灵点击（H1）、③ 覆盖 `overflow: clip` 场景（H2）。代码将裁剪逻辑抽象到共享模块 `clipVisibility.ts`，使渲染和点击测试复用同一套祖先检测 + 矩形交叉逻辑。

**总体评价**: 三个上次标记的问题均已正确修复。架构改进方向清晰（共享裁剪判断、段数稳定、hit-test 对齐）。发现 1 个 MEDIUM 级别新问题（多行部分裁剪时单段 tooltip 泄露）和 2 项建议。

---

## 上次问题修复状态

| ID | 级别 | 描述 | 状态 | 验证说明 |
|:---|:-----|:-----|:-----|:---------|
| C1 | CRITICAL | tooltip 段数抖动 — visibleRects 被用于 segment count | ✅ 已修复 | `positionTooltip()` 中 `desiredCount = Math.max(1, lineRects.length)`，`lineRects` 等于完整 `rects`（不再使用 visible 过滤子集）。裁剪仅作为整体 show/hide 开关（`hasVisibleRect` → `visibility: hidden/visible`），段数和文本拆分均基于全量 rect 集。 |
| H1 | HIGH | 隐藏 tooltip 的幽灵点击 — `visibility:hidden` 的 tooltip 仍返回非零 `getBoundingClientRect` | ✅ 已修复 | `hitTesting.ts` 三个命中阶段均新增跳过逻辑：① 源文本 rect —— `isRectVisibleInClipChain` 过滤裁剪 rect；② tooltip rect —— `tooltip.style.visibility === "hidden"` 跳过；③ 间隙桥接 —— 同时检查 clip 和 visibility。 |
| H2 | HIGH | `overflow: clip` 容器遗漏 — `scrollWidth > clientWidth` 对 `overflow: clip` 无效 | ✅ 已修复 | `clipVisibility.ts` 使用独立标志 `hasClipOverflow = overflowX === "clip" || overflowY === "clip"`，不依赖 `scrollWidth/clientWidth` 比较。该标志与尺寸检查是 OR 关系，确保 `overflow: clip` 即使 `scrollWidth === clientWidth` 也被正确捕获。 |

---

## 🚨 CRITICAL / 🔴 HIGH ISSUES

**无新增 CRITICAL/HIGH 级别问题。**

---

## 🟡 MEDIUM ISSUES

### M1: 多行翻译部分裁剪时，已裁剪行的 tooltip 仍可见（"逃逸"效应）

**文件**: [translationDisplayV2.ts](src/1_content/ui/translationDisplayV2.ts#L283-L293)

**现象**: 当一个多行翻译跨越 overflow 容器边界时（例如上面两行可见、下面一行被 `overflow: hidden` 裁剪），当前的 all-or-nothing 开关会让所有 tooltip 段变为 `visibility: visible`：

```typescript
// 当前逻辑 — all-or-nothing
const hasVisibleRect = rects.some((rect) => isRectVisibleInClipChain(rect, clippingAncestors))
if (!hasVisibleRect) {
    for (const tooltip of entry.tooltips) tooltip.style.visibility = "hidden"
    return
}
for (const tooltip of entry.tooltips) tooltip.style.visibility = "visible"  // ← 所有段都变可见
```

被裁剪行的 tooltip 挂在 `document.body` 上，不受源文本容器的 overflow 剪裁，会"逃逸"到容器上方/下方浮动。Hit-testing 中虽然跳过了被裁剪的 range rect，但这些 tooltip 的 rect 区域仍然可点击（步骤 ② tooltip rect 检查不会跳过它们，因为 `visibility !== "hidden"`）。

**频率**: 仅在多行翻译 + overflow 容器滚动时触发，日常使用较低频。

**建议修复**: 将 visibility 设置改为 per-segment 粒度：

```typescript
for (let i = 0; i < entry.tooltips.length; i++) {
    const rect = lineRects[Math.min(i, lineRects.length - 1)]
    const isVisible = rect && isRectVisibleInClipChain(rect, clippingAncestors)
    entry.tooltips[i].style.visibility = isVisible ? "visible" : "hidden"
}
// 如果全部隐藏则提前 return
if (entry.tooltips.every(t => t.style.visibility === "hidden")) return
```

这仍然基于全量 rects 的 segment count（不会引发 C1 的抖动问题），仅控制每个 segment 的可见性。

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### 1. [Design — 共享裁剪模块的职责清晰度] ✅

`clipVisibility.ts` 作为共享模块，职责单一（祖先检测 + rect 交叉判断），无副作用，两个消费方（渲染 / hit-test）通过相同接口调用。这是本次改动中最干净的架构决策。

### 2. [Performance — scroll 路径上的 `getComputedStyle` 开销]

每次 scroll（通过 rAF）对每个活跃翻译调用 `findClippingAncestors()`，沿 DOM 树向上逐层调用 `window.getComputedStyle()`。

- **代价模型**: `activeTranslations.size × DOM 深度 × getComputedStyle 调用` / 每滚动帧
- **当前缓解**: rAF 保证每帧至多一次；大多数页面翻译数 < 10 且 DOM 深度适中
- **风险场景**: 内容密集型页面（如长推文列表）上同时存在大量翻译，且 DOM 嵌套较深

目前不构成阻断性问题，但值得在性能优化阶段考虑缓存策略（例如基于 `MutationObserver` 失效的祖先缓存）。

### 3. [Consistency — 渲染与 hit-testing 的对齐]

两处代码使用相同的 `range.startContainer.parentElement` 作为 `findClippingAncestors` 的入参，且共享 `isRectVisibleInClipChain` 逻辑。行为一致性良好。

唯一不对称点即 M1 所述：渲染侧对 tooltip 使用 all-or-nothing 可见性，而 hit-testing 侧对 range rect 使用 per-rect 粒度。建议统一为 per-segment 粒度。

### 4. [Resilience — SPA 生命周期兼容性]

新增的裁剪逻辑不影响现有的孤儿检测路径：

- `positionTooltip()` 首先检查 `!entry.range.startContainer.isConnected`，优先于裁剪判断
- `cleanupTranslationById()` 不依赖任何裁剪状态
- `SpaNavigationHandler` 调用 `removeAllTranslationResults()` 全量清理

兼容性无问题。

### 5. [Edge Case — `overflow: clip` 不溢出时的误判]

`findClippingAncestors` 中 `hasClipOverflow` 标志独立于内容尺寸检查，意味着即使 `overflow: clip` 容器的内容未实际溢出，也会被收入祖先列表。这不会导致正确性问题（`isRectVisibleInClipChain` 的矩形交叉仍然通过），仅增加极微量无用计算。可忽略。

---

## 💡 SUGGESTIONS

### S1: `findClippingAncestors` 结果缓存（LOW 优先级）

在 scroll 高频路径下，可以按 `sourceElement` 为 key 做帧级缓存（每帧首次计算后复用，帧末清除）。避免同一帧内多个翻译共享相同源元素时重复遍历祖先链。

```typescript
// 示例: 帧级缓存
const ancestorCache = new WeakMap<HTMLElement, HTMLElement[]>()
let cacheFrameId = 0

export function findClippingAncestors(element: HTMLElement | null): HTMLElement[] {
    if (!element) return []
    const currentFrame = /* rAF frame counter */
    if (currentFrame !== cacheFrameId) { ancestorCache = new WeakMap(); cacheFrameId = currentFrame }
    const cached = ancestorCache.get(element)
    if (cached) return cached
    // ... existing logic ...
    ancestorCache.set(element, ancestors)
    return ancestors
}
```

### S2: 常量命名规范对齐

`clipVisibility.ts` 中 `CLIPPING_OVERFLOW_VALUES` 使用 `Set` 是正确的选择，性能优于 `includes`。建议在文件头添加简短注释说明包含的值与 CSS `overflow` 规范的对应关系，方便后续维护者理解为何 `visible` 和 `inherit`/`initial` 不在集合中。

### S3: hit-test 间隙桥接中的 tooltip 跳过条件可提取

[hitTesting.ts](src/1_content/ui/translationDisplayV2/hitTesting.ts#L173-L175) 中三处 `tooltip.style.visibility === "hidden"` 检查可提取为命名函数 `isTooltipHidden(tooltip)` 以提高可读性并与 `isRectVisibleInClipChain` 在命名层面对齐。

---

## 结论

| 维度 | 评估 |
|:-----|:-----|
| 上次 CRITICAL (C1) | ✅ 已修复 |
| 上次 HIGH (H1) | ✅ 已修复 |
| 上次 HIGH (H2) | ✅ 已修复 |
| 新增 CRITICAL/HIGH | 无 |
| 新增 MEDIUM | 1 项 (M1 — 部分裁剪 tooltip 逃逸) |
| 新增 LOW/建议 | 3 项 (S1 缓存, S2 注释, S3 命名) |
| Type-check | ✅ 通过 |
| 架构一致性 | 良好 — 共享模块设计清晰 |
