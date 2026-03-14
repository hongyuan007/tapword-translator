# V3 Tooltip Spacing Settings — Code Review Report

**审查日期**: 2026-03-10  
**审查范围**: V3 tooltip spacing settings (underline offset, translation offset, bottom spacing) — Options UI, runtime rendering, storage, preview  
**TypeScript 编译**: ✅ `npm run type-check` 无任何错误  

---

## 🛡️ Review Summary

本次变更引入了三个独立的 V3 tooltip 间距控制项（`tooltipUnderlineOffsetPxV3`、`tooltipTextOffsetPxV3`、`tooltipBottomSpacingPxV3`），替换了之前 V2 的单一间距设置。变更涉及 14 个文件，跨越 `0_common`（类型、存储、i18n）、`1_content`（运行时渲染、样式计算、行高调整）以及 `4_options`（设置页 UI、预览、保存）三个模块。

整体实现质量良好，数据流和关注点分离基本合理。Storage 只持久化原始用户值，运行时 `-2px` 内部偏移仅在消费端应用，未出现双重应用或意外持久化。类型定义、默认值、存储规范化、slider 边界约束均已正确实现。

**主要风险点集中在：**
1. 魔法常量 `UNDERLINE_OFFSET_INTERNAL_SHIFT_PX = 2` 在 4 个文件中独立重复定义，属于 DRY 违规。
2. Options 预览的字号计算算法与运行时算法存在结构性差异，无法精确反映实际效果。
3. Slider 极端值（尤其 `0`）产生的负偏移可能导致视觉上下划线与原文重叠。

**未发现 CRITICAL 或 HIGH 级别违规**（无 XSS、无远程代码注入、无硬编码密钥、无 Service Worker 全局状态）。

---

## 🚨 CRITICAL / 🔴 HIGH ISSUES

**无。** 本次变更未触犯安全或 MV3 生命周期相关的严格规则：

- ✅ 无 `eval()` / `new Function()` / 远程 JS 注入
- ✅ 无 Service Worker 中的全局可变状态
- ✅ 无 `innerHTML` 接收未消毒的外部数据（`tooltipRenderer.ts` 仅对 `content.innerHTML = ""` 执行清空操作）
- ✅ 无硬编码 API 密钥
- ✅ Content Script 中的事件监听使用 `passive: true` / `capture: true`，符合最佳实践

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### 1. [DRY 违规] 魔法常量 `UNDERLINE_OFFSET_INTERNAL_SHIFT_PX` 重复定义 — ⚠️ 中等风险

**位置：**
- `src/1_content/index.ts` (L29)
- `src/1_content/ui/translationDisplayV2.ts` (L49)
- `src/1_content/utils/styleCalculator/layout.ts` (L15)
- `src/4_options/index.ts` (L18)

**问题：** 同一个语义值 `2`（将用户友好型 slider 值转换为实际 CSS 偏移的内部偏移量）在 4 个文件中独立定义为局部常量。如果将来需要修改这个偏移量（例如改为 3），必须同步修改 4 处代码，遗漏任何一处都会导致运行时偏移不一致、预览失真或行高计算错误。

**建议：** 将该常量提升至 `src/0_common/constants/` 中，导出为单一常量供所有消费方引用。

---

### 2. [Preview Fidelity] Options 预览字号算法与运行时存在结构性差异 — ⚠️ 中等风险

**位置：**
- Preview: `src/4_options/index.ts` — `computePreviewTooltipFontPx()` (L36-L48)
- Runtime: `src/1_content/utils/styleCalculator/layout.ts` — `calculateOptimalTranslationFontSize()` (L54-L151)

**分析：**

运行时算法：
```
availableSpace = lineSpacing − (underlineSetting − 2)
effectiveAvailable = availableSpace − safetyDelta − textOffset − bottomSpacing
```

预览算法：
```
availableSpace = lineSpacing − PREVIEW_UI_SPACING_PX          // 固定值 3
totalReserved = (underlineSetting − 2) + textOffset + bottomSpacing
effectiveAvailable = availableSpace − PREVIEW_SAFETY_DELTA_PX − totalReserved
```

差异根源在于：运行时将 `underlineOffset` 从 `lineSpacing` 中扣减以计算可用空间，而预览使用固定的 `PREVIEW_UI_SPACING_PX = 3` 来近似，然后将所有三个 V3 设置打包为 `totalReserved` 一次性扣减。这导致：
- 当 slider 取默认值时，预览的 `effectiveAvailable` 始终为 0 或负数，tooltip 字号永远取 `minFontSize`。
- 当 underline slider 从 0 滑到 20 时，运行时 `availableSpace` 的变化范围为 `lineSpacing+2` 到 `lineSpacing-18`，而预览的变化方式不同。

**影响：** 用户调整 slider 时看到的预览效果与实际页面渲染会存在数值差异。方向性一致（增大 slider → 字号减小 → 行高增大），但绝对值可能偏差较大。

**建议：** 考虑将预览的 `availableSpace` 计算改为 `lineSpacing − effectiveUnderlineOffset`（与运行时一致），并将 `PREVIEW_UI_SPACING_PX` 语义替换为实际的 underline offset 参数。

---

### 3. [Edge Case] Slider 极端值 0 产生的负偏移 — ⚠️ 低-中等风险

**位置：**
- `src/1_content/ui/translationDisplayV2.ts` (L328): `underlineOffset = 0 − 2 = −2`
- `src/1_content/index.ts` (L39): CSS variable `--ai-translator-underline-offset: −2px`

**分析：** 当用户将 "原文离下划线距离" slider 拖至 0 时：
- V1 路径：CSS `text-underline-offset: -2px` 导致下划线上移至文字基线以上
- V2 路径：tooltip 的 `top = rect.bottom + scrollY − 2`，即 tooltip border-top（充当下划线）位于原文底部上方 2px

两种情况都可能导致 "下划线" 视觉上与原文紧密重叠甚至嵌入文字内部。

**建议：** 
- 方案 A：将 slider 的 `min` 从 `0` 改为 `2`，使有效偏移最小为 0px（无负偏移）。
- 方案 B：保持 slider 范围不变，但在 helper 文本中说明 "低于某个值时下划线可能与原文重叠"。

---

### 4. [Data Flow] 运行时读取 V3 设置分散在多处 `getCachedUserSettings()` 调用 — 🔵 低风险

**位置：**
- `translationDisplayV2.ts` L326-330：`positionTooltip()` 在每次滚动/resize 时读取 `cachedSettings`
- `layout.ts` L68-72：`calculateOptimalTranslationFontSize()` 读取 `cachedSettings`
- `lineHeightAdjuster.ts` L100-102：`calculateRequiredLineHeightIncrease()` 读取 `cachedSettings`

**分析：** V3 设置在翻译流程的多个阶段被独立读取。如果用户在 Options 页面修改了设置，`chrome.storage.onChanged` 会更新 `userSettings` 缓存，但已经渲染的 tooltip 的 `positionTooltip()` 会在下一次 scroll/resize 时使用新设置重新定位。同时 `spaceCalculation` 对象（在创建时由 `layout.ts` 计算）中的 `availableSpace` 仍基于旧设置。这可能导致 `lineHeightAdjuster` 在恢复行高时使用新设置而不是创建时的设置。

**实际影响有限**：因为行高调整只在创建翻译时发生一次，后续只做 ref-count 增减，不会重新计算。但这是一个架构上值得注意的组合性风险。

**建议：** 如果未来需要支持 "实时更新已有翻译的间距"，应考虑在 `TranslationEntry` 中快照创建时的 V3 设置。

---

### 5. [Side Effect] Tooltip 内容包装器对截断检测的潜在影响 — 🔵 低风险

**位置：**
- `tooltipRenderer.ts` L49-53：`createTooltipElement()` 新增 `.ai-translator-tooltip-content` 子 div
- `tooltipRenderer.ts` L123：`checkTruncation(tooltip)` 仍检查外层 tooltip 元素

**分析：** `checkTruncation()` 通过 `element.scrollWidth > element.clientWidth` 判断文本是否溢出。引入内容包装器后：
- 外层 tooltip 有 `overflow: hidden` + `white-space: nowrap`
- 内容 div 为 `display: block`，宽度继承父容器
- 文本在内容 div 内部溢出，反映为外层 tooltip 的 `scrollWidth`

经验证，这种嵌套结构下 `scrollWidth` 仍能正确反映内容溢出，因此截断检测逻辑应该不受影响。

但需注意：内容 div 的 `paddingBottom`（来自 `bottomSpacing`）增加了 tooltip 的总高度。这会扩大 hit-testing 中 tooltip 的 `getBoundingClientRect()` 高度，使得点击区域纵向增大。对于用户来说这是正面效果（更容易点击到 tooltip），但如果 `bottomSpacing` 设为极大值（如 20px），可能导致 tooltip 的点击区域侵入下一行文字。

---

### 6. [Storage Semantics] 存储与渲染语义分离 — ✅ 正确实现

**验证结果：**
- `storageManager.ts` L156-158：V3 值使用 `mergedSettings.xxx ?? DEFAULT` 进行规范化，存储原始用户值
- 内部 `-2px` 偏移仅在以下 4 个消费点应用，未持久化：
  - `content/index.ts` L38-39：CSS variable
  - `translationDisplayV2.ts` L328：tooltip 定位
  - `layout.ts` L70：字号计算
  - `options/index.ts` L29：预览定位
- 加载时不存在双重应用风险（`normalizeUserSettings` 不对 V3 值做变换）

---

### 7. [Options Initialization] Slider 初始化顺序 — ✅ 基本正确，有一个小冗余

**验证结果：**
- `loadSettings()` 通过 `input[type="range"][data-setting]` 选择器设置所有 range input 的值，并 dispatch `input` 事件
- `setupTooltipSpacingPreview()` 中的 `if (!underlineInput.value)` fallback 在正常流程下永远不会触发（因为 `loadSettings` 先执行），但作为防御性代码是合理的
- Range input 的 HTML 没有 `value` 属性，浏览器默认使用 `(min+max)/2 = 10`。如果 `loadSettings()` 失败，slider 会显示 10 而非实际默认值（1, 1, 6）
- `settingsManager.ts` 的 `change` handler 正确约束值到 `[0, 20]` 范围

---

### 8. [Line-Height Calculations] V3 参数与行高调整的交互 — ✅ 逻辑一致

**验证结果：** 三个 V3 参数在行高计算中的作用链：

```
layout.ts:
  availableSpace = lineSpacing − underlineOffset        // underlineOffset = setting − 2
  effectiveAvailable = availableSpace − safety − textOffset − bottomSpacing
  fontSize = clamp(effectiveAvailable, min, max)

lineHeightAdjuster.ts:
  targetAvailableSpace = minFontSize + safety + textOffset + bottomSpacing
  increase = max(targetAvailableSpace − availableSpace, 0)
  // 其中 availableSpace 来自 spaceCalc（已包含 underlineOffset 的影响）
```

展开后：`increase = minFontSize + safety + textOffset + bottomSpacing − lineSpacing + underlineOffset`

三个 V3 参数均正确参与计算，`underlineOffset` 通过 `availableSpace` 间接传递，`textOffset` 和 `bottomSpacing` 在两个计算步骤中对称出现。

---

## 💡 SUGGESTIONS

### S1. 提取共享常量，消除 DRY 违规
将 `UNDERLINE_OFFSET_INTERNAL_SHIFT_PX = 2` 和 `resolveEffectiveUnderlineOffsetPx()` 提取到 `src/0_common/constants/` 中。

### S2. 为 Range Input 添加 HTML `value` 属性作为防御
在 `index.html` 中为三个 range input 添加与 `DEFAULT_USER_SETTINGS` 一致的 `value` 属性：
```html
<input type="range" ... value="1" />   <!-- tooltipUnderlineOffsetPxV3 -->
<input type="range" ... value="1" />   <!-- tooltipTextOffsetPxV3 -->
<input type="range" ... value="6" />   <!-- tooltipBottomSpacingPxV3 -->
```
这样即使 JS 初始化失败，slider 也不会显示 10（midpoint）的错误值。

### S3. 考虑清理未使用的 i18n 范围标签
`popup.range.closer`、`popup.range.farther`、`popup.range.less`、`popup.range.more` 已在 `zh.json` / `en.json` 中定义，但未在 `index.html` 的 range 控件旁使用。如果计划在 slider 两端添加标签，应完成实现；否则考虑移除这些未引用的 key。

### S4. 预览中统一使用运行时的偏移算法
`computePreviewTooltipFontPx()` 中将 `PREVIEW_UI_SPACING_PX` 替换为 `effectiveUnderlineOffsetPx` 参数，使预览可用空间计算与 `layout.ts` 结构一致。需要将函数签名改为接受 `effectiveUnderlineOffsetPx` 单独参数。

### S5. 监控极端组合值对布局的影响
建议添加 E2E 或手动测试用例覆盖：
- 三个 slider 均为 0（最大压缩，负偏移）
- 三个 slider 均为 20（最大扩展）
- `underlineOffset=0, textOffset=20, bottomSpacing=20`（极端不对称）
- 在 heading (h1-h6)、窄列布局、低行高内容中验证上述组合

---

## 审查清单（对照 Manifest Risk Items）

| # | 风险项 | 结论 |
|---|--------|------|
| 1 | 逻辑一致性：三个控制独立不重叠 | ✅ 每个设置在不同 CSS 属性/样式维度生效 |
| 2 | Storage vs Render：不双重应用 | ✅ 原始值存储，`-2` 仅在 4 个消费点应用 |
| 3 | Options 初始化：slider 从设置加载 | ✅ `loadSettings()` 正确 hydrate，但 HTML 缺少 `value` fallback |
| 4 | 预览保真度 | ⚠️ 算法结构性差异，方向一致但数值有偏差 |
| 5 | 副作用：包装器/偏移对截断/spinner/多行 | ✅ 截断检测兼容，spinner 正确处理 |
| 6 | 行高计算 | ✅ 三个参数正确参与计算 |
| 7 | 极端值/边缘情况 | ⚠️ slider=0 产生负偏移，需验证视觉效果 |
| 8 | 本地化/UX 文案 | ✅ 中英文标签清晰，有未使用的范围标签 |
