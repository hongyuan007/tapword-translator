# V2 Tooltip 多行显示 & Hit-Test 改进 — Code Review Report

**日期**: 2026-03-09  
**审查范围**: `translationDisplayV2.ts`, `hitTesting.ts`, `types.ts`, `tooltipLayout.ts`, `tooltipRenderer.ts`  
**审查依据**: `chrome-extension-review.prompt.md` 规则 + Manifest AI Disclaimer 风险项

---

## 🛡️ Review Summary

本次变更围绕两个目标：(1) V2 tooltip 系统支持多行选区时每条源文本行都保留下划线与 tooltip 段，即使翻译文本行数少于源文本行数；(2) 收窄 hit-test 区域，避免点击相邻未翻译文字时误触翻译弹窗。

整体架构思路合理——保持 Range-based 零入侵设计，通过 `ensureTooltipSegmentCount` 动态调整 tooltip 数量，通过按行索引配对 rangeRect ↔ tooltip 收窄 gap-bridge。但存在 **6 个 TypeScript 编译错误**（其中 1 个是类型设计缺陷，5 个是 `undefined` 安全检查缺失），以及若干逻辑层面的潜在风险。

**编译状态**: ❌ **6 errors in 2 files** — 不可合入。

---

## 🚨 CRITICAL / 🔴 HIGH ISSUES

### 🚨 C-1: TypeScript 编译失败（6 errors, 2 files）

`npm run type-check` 报告 6 个错误，代码无法通过编译。

#### C-1a: `adjustedBlocks` 类型不匹配 (translationDisplayV2.ts:556)

```
TS2345: Argument of type 'LineHeightAdjustmentResult' is not assignable to parameter of type 'HTMLElement'.
```

**根因**: `adjustedBlocks` 声明为 `Map<string, HTMLElement>`，但 `lineHeightAdjuster.adjustLineHeightIfNeeded()` 返回的是 `LineHeightAdjustmentResult`（包含 `{ blockElement: HTMLElement | null; didAdjustLineHeight: boolean }`）。代码直接 `.set(id, adjustedBlock)` 而未解包。

**修复方向**:
```typescript
const result = lineHeightAdjuster.adjustLineHeightIfNeeded(parentElement, styleResult.spaceCalculation)
if (result.didAdjustLineHeight && result.blockElement) {
    adjustedBlocks.set(id, result.blockElement)
}
```
同时需要审视 cleanup 路径中 `restoreLineHeight(mappedBlock, ...)` 是否也需要同步适配。

**风险**: 如果 `if (adjustedBlock)` 的真值判断在运行时恰好成立（对象始终 truthy），会把错误类型存入 Map，导致 `restoreLineHeight` 接收到非 `HTMLElement` 参数，运行时可能静默失败或异常。

#### C-1b: `rangeRect` 可能为 `undefined` (hitTesting.ts:201-213, 5 errors)

```
TS18048: 'rangeRect' is possibly 'undefined'.
```

**根因**: `for (let i = 0; i < rangeRects.length; i++)` 循环中通过 `rangeRects[i]` 索引访问，TypeScript strict 模式下数组索引返回 `T | undefined`。

**修复方向**: 在循环体顶部添加 guard：
```typescript
const rangeRect = rangeRects[i]
if (!rangeRect || rangeRect.width === 0 || rangeRect.height === 0) continue
```

---

### 🔴 H-1: Tooltip 段数与翻译文本段数不匹配时可能产生空白/布局错位

**位置**: `translationDisplayV2.ts` — `positionTooltip()` 函数

**问题**: `desiredCount = Math.max(1, lineRects.length)` 确保 tooltip 段数等于源文本行数，但 `cached` 数组（`tooltipSegmentsCache`）的长度取决于 `splitTextAcrossRects` 的返回值，可能少于 `lineRects.length`。当 `i >= cached.length` 时，`cached[i]` 为 `undefined`，`setTooltipText(tooltip, cached[i] ?? "", ...)` 会设置空字符串。

**行为**: 超出翻译文本覆盖范围的 tooltip 段会变成纯下划线行（只有 `minWidth`/`maxWidth` 但无文字内容），这在设计意图上看起来是正确的（保留下划线），但需要确认：
1. 空 tooltip 段的 CSS 渲染是否产生了预期的下划线效果（`border-top` 或其他 CSS 属性在空内容时是否仍然生效）。
2. `checkTruncation` 对空文本调用时 `scrollWidth > clientWidth` 是否会产生不正确的 class 添加。

**建议**: 添加注释明确说明空段的设计意图；验证空段的 CSS 最小高度规则。

---

### 🔴 H-2: Hit-Test Gap-Bridge 按索引配对假设可能失效

**位置**: `hitTesting.ts` — `isPointInsideTranslationZone()` 的第三段 gap-bridge 逻辑

**问题**: Gap-bridge 循环使用 `rangeRects[i]` 与 `tooltips[i]` 的 1:1 索引配对。这依赖于一个隐含假设：**tooltip 段数始终等于 rangeRect 行数**。

当前 `positionTooltip` 中通过 `ensureTooltipSegmentCount(id, Math.max(1, lineRects.length), ...)` 保证了这一点。但 `isPointInsideTranslationZone` 是一个 **exported public 函数**，被 `isPointInsideActiveTranslation` 直接调用，传入的 `entry.tooltips` 来自 `TranslationEntry` 的快照。如果在以下时序中调用：

1. `positionTooltip` 尚未运行（初次 `showTranslationResult` 后 tooltip 只有 1 个段）
2. 此时触发 click → `isPointInsideTranslationZone` 以 1 个 tooltip vs N 个 rangeRects 运行

则 gap-bridge 只覆盖第一行，其余行的 gap 不可点击。这在单击翻译模式下可能导致多行翻译的非首行区域点击无响应。

**建议**: gap-bridge 循环中使用 `Math.min(rangeRects.length, tooltips.length)` 作为上限（已隐式通过 `if (!tooltip) continue` 实现），但应添加显式 comment 说明此约束。

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### 🧩 A-1: Reflow/Resize 后 tooltip 段数与缓存一致性

**风险类型**: 状态一致性

`positionTooltip` 在每次 scroll/resize 时运行。如果页面 reflow 导致 `getNormalizedLineRects(entry.range)` 返回不同数量的行：
- `ensureTooltipSegmentCount` 会添加/移除 segment DOM 元素。
- `splitTextAcrossRects` 会按新的 `lineRects` 重新分割文本。
- `rectSignatureCache` 正确失效。

这个链路看起来完整，**但有一个边缘情况**: 如果 reflow 导致行数从 3 变为 1（例如容器变宽），**shrink path** 中 `ensureTooltipSegmentCount` 会 `remove()` 多余的 tooltip，但这些 tooltip 可能正被 `hitTesting` 的 `findHitTranslationByPoint` 在同一帧中使用（因为 `getActiveTranslations` 返回的是实时的 `entry.tooltips` 引用）。虽然 `getBoundingClientRect` 对已 remove 的元素返回零尺寸 rect，不会产生 false positive，但这属于隐式依赖。

**建议**: 在 `ensureTooltipSegmentCount` 的 shrink 路径中，先清除旧 tooltip 引用再 remove DOM，或在 `isPointInsideTranslationZone` 中增加 `isConnected` guard。

### 🧩 A-2: 多行文本对齐规则的语义正确性

**位置**: `positionTooltip()` 中的 `tooltip.style.textAlign = isSingleLine ? "center" : "left"`

**分析**: `isSingleLine` 基于 `segments.length === 1`，而 `segments` 此时已等于 `desiredCount`（= `lineRects.length`）。这意味着：
- 单行选区 → 居中 ✅
- 多行选区 → 左对齐 ✅

但考虑如下场景：用户选择了 2 行文本，翻译结果非常短（例如 "Yes"）。此时有 2 个 tooltip 段，每个段的 `maxWidth` 等于对应 rangeRect 宽度。第一个段显示 "Yes"，第二个段为空。两个段都是 `textAlign: "left"`。从视觉上看，"Yes" 靠左显示在第一行下方，第二行下方只有空白/下划线。

**疑问**: 这种 "翻译极短但源文本多行" 的场景，左对齐是否是最佳 UX？V1 的行为是什么？

### ⏳ A-3: `splitTextAcrossRects` 在 spinner 状态下被跳过但缓存被清空

**位置**: `positionTooltip()` 中 `isSpinner` 分支

当 `isSpinner === true` 时，`tooltipSegmentsCache.set(id, [])` 设置为空数组。后续 `for` 循环中 `cached[i]` 全部为 `undefined`，`setTooltipText` 因 `tooltip.dataset.loadingVariant === "spinner"` 检查而跳过。

**逻辑**: 在 loading spinner 状态下，所有额外的 tooltip 段（第 2、3 行）会被 `ensureTooltipSegmentCount` 创建并 `syncTooltipStyles` 复制样式。但这些新段并未被设置为 spinner 变体（`dataset.loadingVariant` 只在 `renderTooltipContent` 中设置，只设置第一个 tooltip）。

**结果**: 非首行 tooltip 段在 loading 状态下可能显示为空白（无 spinner、无文字），这取决于它们的 CSS 是否有最小高度。如果 CSS 为空 tooltip 渲染了下划线，这可能是可接受的（loading 状态下只有第一行有 spinner，其余行有下划线）。但如果设计意图是每行都显示 loading 状态，则这里有 gap。

**建议**: 在代码中添加注释明确 loading 状态下非首行段的预期行为。

### 🛡️ A-4: `ensureTooltipSegmentCount` 中 class 复制的全量性

**位置**: `ensureTooltipSegmentCount` 的 `for (const cls of Array.from(baseTooltip.classList))` 循环

**风险**: 这里会复制 `baseTooltip` 的**所有** CSS class，包括 `loading`、`error`、`is-truncated` 等状态类。对于新创建的空段，继承 `is-truncated` class 可能导致不必要的 fade-out mask 效果。虽然后续 `setTooltipText` 会通过 `checkTruncation` 重新评估，但在 `requestAnimationFrame` 回调执行前会有短暂的视觉闪烁。

**建议**: 考虑使用白名单复制（只复制 `visible`、`ai-translator-tooltip--fragment` 等必要类），或在创建后立即移除不适用的状态类。

---

## 💡 SUGGESTIONS

### S-1: `rangeContainsPosition` 函数当前未被调用

`hitTesting.ts` 中的 `rangeContainsPosition` 函数已 export，但整个代码库中似乎未被使用（hit-test 改为纯 rect-based 后，caret-based 检测成为死代码）。

**建议**: 确认是否仍需保留。如果是为未来预留，添加 `// @reserved` 注释；否则移除以减少维护负担。

### S-2: `positionTooltip` 中 `segs` 与 `segments` 变量命名混淆

```typescript
const segments = ensureTooltipSegmentCount(id, desiredCount, baseTooltip)
// ...
const segs = entry.tooltips
for (let i = 0; i < segs.length; i++) {
```

`segments` 被赋值但在后续循环中未使用，循环使用的是 `segs`（= `entry.tooltips`）。虽然 `ensureTooltipSegmentCount` 修改了 `entry.tooltips` 就地更新，二者引用同一数组，但这种写法容易让读者误解。

**建议**: 移除 `segments` 变量或统一使用 `entry.tooltips`。

### S-3: 常量 `FADE_IN_DELAY_MS = 10` 应提取到 types.ts

`showTranslationResult` 中的 `const FADE_IN_DELAY_MS = 10` 是一个局部常量，按项目规范应提取到 `types.ts` 中的命名常量区域。

### S-4: Gap-Bridge 循环可提取为独立函数

`isPointInsideTranslationZone` 中的三段逻辑（rangeRect check → tooltip check → gap-bridge）较长。Gap-bridge 段可以提取为 `isPointInGapBetweenLineAndTooltip(x, y, rangeRect, tooltipRect)` 以提高可读性和可测试性。

### S-5: `splitTextAcrossRects` 的 `longestPrefixThatFits` 对 CJK 字符的分词问题

`longestPrefixThatFits` 的 word-boundary snapping 只查找空格/换行/tab（`lastIndexOf(" ")`），对 CJK 文本无效（CJK 字符间无空格）。这意味着 CJK 翻译文本可能在字符中间被截断。虽然 CSS fade mask 会处理视觉溢出，但截断位置不理想可能导致单行末尾只有半个字符宽度的空白。

**影响**: 低（CSS 处理了溢出），但 CJK-heavy 用户可能注意到次优排版。

---

## 附录: 类型检查完整输出

```
src/1_content/ui/translationDisplayV2.ts:556:40 - error TS2345
  Argument of type 'LineHeightAdjustmentResult' is not assignable to parameter of type 'HTMLElement'.

src/1_content/ui/translationDisplayV2/hitTesting.ts:201:13 - error TS18048 (×5)
  'rangeRect' is possibly 'undefined'.

Found 6 errors in 2 files.
```
