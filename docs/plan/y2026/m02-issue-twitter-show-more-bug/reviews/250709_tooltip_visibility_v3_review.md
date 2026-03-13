# Tooltip Visibility Clip-Chain V3 Review (Per-Segment 可见性)

**日期**: 2026-03-13  
**审查轮次**: 第 3 轮  
**审查范围**: per-segment 可见性实现 — `clipVisibility.ts`, `translationDisplayV2.ts`, `hitTesting.ts`  
**Type Check**: ✅ `npm run type-check` 通过，无错误

---

## 🛡️ Review Summary

第 3 轮迭代将 tooltip 可见性从"全翻译显示/隐藏门控"升级为**逐段（per-segment）可见性控制**。每个 tooltip segment 的 `visibility` 属性现在独立追踪其对应的源文本行 rect 是否被裁剪链遮挡。

整体实现质量良好。核心逻辑正确，前两轮发现的所有问题均已修复。新增的 per-segment 可见性逻辑简洁且与 hit testing 保持一致。发现 1 个低优先级性能建议和 1 个信息级边缘 case。

---

## ✅ 历史问题验证

| 编号 | 问题描述 | 状态 | 验证依据 |
|:--:|:--|:--:|:--|
| C1 | Segment 数量应基于完整 rects 集合，避免滚动时抖动 | ✅ 已修复 | `positionTooltip()` 中 `desiredCount = Math.max(1, lineRects.length)` 始终使用完整 `rects`（未过滤可见子集），segment 数量在滚动期间保持稳定 |
| H1 | 隐藏的 tooltip 不应参与 hit testing | ✅ 已修复 | `hitTesting.ts` 在 range rect 检查中使用 `isRectVisibleInClipChain()` 跳过被裁剪的 rect；tooltip rect 和 gap bridging 均检查 `tooltip.style.visibility === "hidden"` |
| H2 | `overflow: clip` 应被识别为裁剪容器 | ✅ 已修复 | `clipVisibility.ts` 的 `CLIPPING_OVERFLOW_VALUES` 包含 `"clip"`；`findClippingAncestors()` 对 `overflow: clip` 无条件视为裁剪祖先（`hasClipOverflow` flag），不依赖 `scrollWidth > clientWidth` 判断 |
| M1 | 多行 tooltip 应逐段控制可见性，避免被裁剪的行逃逸到容器外 | ✅ 已修复 | `positionTooltip()` 使用 `visibleRectFlags = rects.map(r => isRectVisibleInClipChain(r, clippingAncestors))`，循环中按索引 `visibleRectFlags[i]` 独立设置每段 `tooltip.style.visibility` |

---

## 🚨 CRITICAL / 🔴 HIGH ISSUES

无。

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### 1. Per-Segment 可见性：逻辑正确性 ✅

**核心流程分析** (`translationDisplayV2.ts` `positionTooltip()`):

```
rects = getNormalizedLineRects(range)         // 完整 rects 集合（不过滤）
visibleRectFlags = rects.map(isVisible)       // 逐项可见性标记
desiredCount = Math.max(1, rects.length)      // segment 数量 = rect 数量
ensureTooltipSegmentCount(id, desiredCount)   // 保证 DOM 元素数量匹配

for each segment[i]:
    isVisible = visibleRectFlags[i]           // 1:1 索引对应
    tooltip.visibility = isVisible ? "visible" : "hidden"
```

**验证要点**:
- Segment 数量由 `rects.length` 决定，滚动不影响数量 → 布局稳定
- 文本分割由 `buildRectsSignature` 缓存，仅在 rect 位置/宽度变化时重新计算 → 无抖动
- `visibleRectFlags` 数组长度与 `rects` 长度一致 → 索引映射安全
- 全部 rect 被裁剪时提前返回（`!hasVisibleRect` → 全部隐藏） → 快速路径正确

### 2. Hit Testing 与可见性对齐 ✅

`hitTesting.ts` 的 `isPointInsideTranslationZone()` 三层检查：

| 检查层 | 可见性过滤 | 验证状态 |
|:--|:--|:--:|
| Range text rects | `isRectVisibleInClipChain(rect, clippingAncestors)` — 跳过被裁剪的 rect | ✅ |
| Tooltip element rects | `tooltip.style.visibility === "hidden"` — 跳过隐藏 tooltip | ✅ |
| Gap bridging (range ↔ tooltip) | 同时检查 range rect 可见性和 tooltip 可见性 | ✅ |

Rendering 与 hit testing 共享 `clipVisibility.ts` 的 `findClippingAncestors` 和 `isRectVisibleInClipChain`，行为一致。

### 3. 布局稳定性 ✅

- `positionTooltip()` 中 `lineRects` 直接引用完整 `rects` 集合
- `splitTextAcrossRects()` 的输入 `widths` 基于完整 `lineRects.map(r => r.width)`
- `buildRectsSignature()` 使用 `RECT_SIGNATURE_ROUND_PX = 1` 进行四舍五入，抑制亚像素滚动抖动
- 签名变化时才重新分割文本（`signature !== lastSignature`）

结论：滚动期间 segment 数量、文字分割、rect-to-segment 映射均保持稳定。

### 4. `ensureTooltipSegmentCount` 新增段初始化

新创建的 segment 从 `baseTooltip` 继承 classes（包括 `visible`）和 `visibility` style。这些值随后在 `positionTooltip()` 的逐段循环中被覆盖。由于在同一 rAF 内完成，不会产生视觉闪烁。逻辑无害但存在少量冗余初始化。

---

## 💡 SUGGESTIONS

### S1: 性能 — `findClippingAncestors` 滚动帧内重复计算 (Low)

**位置**: `clipVisibility.ts` → `findClippingAncestors()`

**现状**: 每次 `positionTooltip()` 调用都会重新遍历源元素的祖先链，对每个节点调用 `getComputedStyle()` 并读取 `scrollWidth`/`clientWidth`（可能触发布局查询）。在一帧内若有 N 个活跃翻译，则执行 N 次完整祖先遍历。

**影响**: 对于典型场景（1-5 个翻译）可接受。但在深层嵌套 DOM（如 Twitter）+ 大量活跃翻译时，可能成为滚动帧预算瓶颈。

**建议**: 可考虑在 `scheduleReposition` 的 rAF 回调中，对同一源元素的裁剪祖先进行帧级缓存（同一帧内共享结果），或以 `WeakMap<Element, HTMLElement[]>` + 帧计数器做简单缓存。当前不急需，作为后续优化备选。

### S2: 信息 — `overflow: hidden` 搭配绝对定位子元素的极端 case (Info)

**位置**: `clipVisibility.ts` → `findClippingAncestors()`

**现状**: 对非 `overflow: clip` 的值（`hidden`, `scroll`, `auto`），函数要求 `scrollWidth > clientWidth` 或 `scrollHeight > clientHeight` 才识别为裁剪祖先。绝对定位子元素不贡献 `scrollWidth`/`scrollHeight`，因此一个 `overflow: hidden` 容器内绝对定位越界的内容不会被检测为"需要裁剪"。

**影响**: 极端 edge case，在翻译场景中几乎不会遇到（翻译的 range 通常在 inline flow 内）。记录备忘即可。

---

## 📋 最终结论

| 维度 | 评估 |
|:--|:--|
| 历史问题（C1, H1, H2, M1） | 全部修复 ✅ |
| Per-segment 可见性正确性 | 正确 ✅ |
| 布局稳定性 | 稳定 ✅ |
| Hit testing 对齐 | 对齐 ✅ |
| 性能 | 可接受，有优化空间 (S1) |
| 边缘 case | 已合理覆盖，极端 case 记录备忘 (S2) |
| TypeScript 类型安全 | 通过 ✅ |

**整体评价**: 第 3 轮迭代质量良好，核心 per-segment 可见性逻辑正确，与 hit testing 保持一致，无阻塞性问题。建议合并。
