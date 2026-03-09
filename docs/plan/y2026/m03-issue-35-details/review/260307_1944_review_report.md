# Code Review Report — Issue #35: Tooltip Scroll-Drift Fix

**Reviewed File**: `src/1_content/ui/translationDisplay.ts` (lines 234–235)
**Manifest**: `docs/plan/y2026/m03-issue-35-details/review/260307_1944_manifest.md`
**Date**: 2026-03-07

---

## 🛡️ 审查总结

此修复针对 body 充当滚动容器时（`position:relative` + `overflow-y:auto`）的 tooltip 位移问题，思路正确、目标明确。核心公式 `window.scrollY + document.body.scrollTop` 在**大多数现代页面**（standards-mode + 单滚动容器）下可以安全地得出正确结果。

然而存在一个实质性的兼容性缺陷：**在 Quirks Mode 页面上，`window.scrollY` 与 `document.body.scrollTop` 会同时反映同一个滚动偏移量，导致公式将其累加两次**，使 tooltip 偏移量加倍。此问题属于可重现的真实缺陷，需要修复。

此外，代码中存在若干可观察到的弱点（scroll 监听器对 body-scroll 触发路径的依赖、`findScrollableParent` 与 body-scroll 场景的交互、多容器双重滚动的理论风险），均在下文详细说明。

---

## 🚨 CRITICAL / 🔴 HIGH ISSUES

无 CRITICAL 级别违规（无 `eval`、无 `innerHTML` 注入、无全局状态滥用、无硬编码密钥）。

---

## 🧠 架构与逻辑深度分析

### 1. ✅ 特定场景的正确性（body-scroll 页面）

**结论：在目标场景下逻辑正确。**

在 body-scroll 布局下（`<body style="position:relative; overflow-y:auto">`）：

- `window.scrollY` = 0（视口/窗口未发生滚动）
- `document.documentElement.scrollTop` = 0（同上）
- `document.body.scrollTop` = 累计滚动量

修复后 `scrollY = 0 + document.body.scrollTop`，恰好等于实际偏移量。
`fix-analysis.md` 中的调试日志数据（scrollY 由 0→80→160→240）验证了此公式。

---

### 2. 🔴 普通页面兼容性——Quirks Mode 下的双重计数

**结论：存在真实缺陷，影响没有 DOCTYPE 的历史页面。**

**Standards Mode（现代页面，`<!DOCTYPE html>`）**：
- 滚动时：`window.scrollY > 0`，`document.body.scrollTop = 0`
- `scrollY` 之和 = `window.scrollY` ✓

**Quirks Mode（无 DOCTYPE 或旧式 DOCTYPE）**：
- Chrome 和 Firefox 在 quirks mode 下，**`document.body.scrollTop` 会镜像页面滚动量**，与 `window.scrollY` 相同，两者同时非零。
- 修复后公式：`window.scrollY + document.body.scrollTop` = `2 × 实际滚动量`
- 这将导致 tooltip 在**向下滚动时偏移量加倍**，产生与修复前相反方向的漂移。

**影响评估**：Quirks Mode 在现代 SPA 和文档站（如 OpenAI Docs）中极为罕见，但在企业内网、遗留内容系统中仍然存在。

**建议修复方案**：

```ts
// 更健壮的做法：仅当 window.scrollY 为 0 时才使用 body.scrollTop（防止双重计数）
const bodyScrollY = window.scrollY === 0 && document.documentElement.scrollTop === 0
    ? (document.body?.scrollTop || 0)
    : 0
const scrollY = (window.scrollY || document.documentElement.scrollTop || 0) + bodyScrollY
```

此写法明确了意图：`body.scrollTop` 仅作为 `window.scrollY`/`documentElement.scrollTop` 均为零时的补充，完全避免了双重计数。

---

### 3. ✅ `window` scroll 监听器对 body-scroll 事件的覆盖

**结论：`capture: true` 可以正确捕获 body 滚动事件，无需额外监听器。**

`ensureGlobalRepositionListeners` 使用：
```ts
window.addEventListener("scroll", scheduleReposition, { passive: true, capture: true })
```

DOM 事件捕获阶段路径为 `Window → Document → HTML → BODY → … → target`。  
即使 `scroll` 事件不冒泡（`bubbles: false`），**捕获阶段仍会在到达目标前经过 `window`**，因此 `window` 的 capture 监听器**会可靠地触发**。

这一行为在 Chrome、Firefox、Safari、Edge 中均一致，此部分实现正确。

---

### 4. ⚠️ `findScrollableParent` 与 body-scroll 页面的交互

**结论：行为正确但有隐式假设值得明确。**

`findScrollableParent` 遍历至 `tagName !== "HTML"` 为止，因此 `<body>` 在 body-scroll 场景下**会被正常识别并返回**（body 具有 `overflow-y:auto` 且 `scrollHeight > clientHeight`）。

`setupVisibilityObserver` 于是将 `root: body` 传给 IntersectionObserver。这对于检测 anchor 是否在 body 可视区域内是语义正确的，不会引发错误隐藏。

**潜在的理论隐患（低优先级）**：  
该函数仅检测 `overflow-y/x`，并不检测 `position: relative`。  
在 body-scroll 页面上，body 同时满足"positioning context"和"scroll container"双重角色。`findScrollableParent` 只关注滚动，不关注定位，但实际上在 `positionTooltip` 的计算中两者同等重要。目前的逻辑是分开处理的（定位由 scrollY 公式负责，可视性由 IntersectionObserver 负责），两者解耦清晰，无问题。

---

### 5. ✅ Iframe 场景

**结论：行为正确。**

当扩展在 iframe 内运行时：
- `window.scrollY` 反映 iframe viewport 的滚动
- `document.body.scrollTop` 反映 iframe 的 body 滚动
- tooltip 被挂载到 iframe 的 `document.body`，`position:absolute` 相对于 iframe 的定位根

所有坐标系均在同一 iframe 文档内自洽，公式正确。

---

### 6. ✅ RTL / 水平滚动（scrollX）

**结论：同等修复，同等风险。**

```ts
const scrollX = (window.scrollX || document.documentElement.scrollLeft || 0) + (document.body?.scrollLeft || 0)
```

逻辑结构与 `scrollY` 完全对称，Standards Mode 下正确，Quirks Mode 下同样存在双重计数。

**额外 RTL 风险**：Firefox 在 RTL 文档中 `scrollLeft` 可为负值（标准变更前的遗留行为）。若 body-scroll 页面同时是 RTL，`document.body.scrollLeft` 可能是负数，与 `window.scrollX`（通常为正或零）相加结果可能不正确。此为低优先级、极端边缘场景，但与 Quirks Mode 问题的修复方向一致（即仅在 `window.scrollX === 0` 时才加 body.scrollLeft）。

---

### 7. ⚠️ 理论上的双滚动容器双重计数场景

**结论：理论存在，实际极罕见，可接受。**

若页面同时定义：
```css
html { overflow-y: auto; height: 100vh; }  /* window scroll container */
body { overflow-y: auto; height: 200vh; position: relative; }  /* independent body container */
```

则 `window.scrollY > 0` 且 `document.body.scrollTop > 0` 可同时成立。  
此时当前修复会将两个独立的滚动偏移量累加，而实际 tooltip 定位仅需其中一个（body 的滚动偏移，因为 tooltip 挂在 body 上）。

在真实互联网页面中，此布局实际上不存在（使用 body 作滚动容器的站点通常会禁止 html/window 同时滚动）。标记为低优先级风险，可通过第 2 点建议的修复方案一并消除。

---

### 8. ✅ `||` 运算符语义分析

**结论：逻辑无误。**

```ts
(window.scrollY || document.documentElement.scrollTop || 0)
```

在 body-scroll 页面上：`window.scrollY = 0` → 求值 `document.documentElement.scrollTop = 0` → 求值 `0`。
最终加上 `document.body.scrollTop`，结果正确。

在标准页面上：`window.scrollY > 0` → 短路求值，使用 `window.scrollY`。
`document.body.scrollTop = 0`（Standards Mode）。结果正确。

运算符语义在目标场景下均符合预期。

---

### 9. ✅ 其他未处理的滚动容器（overflow:auto 的内部 div）

**结论：tooltip 定位在内部 div 滚动场景下已经正确，无需此次修复介入。**

当 anchor 位于某个内部 `<div>` 滚动容器内（非 body、非 window）：
- `window.scrollY = 0`（window 未滚动）
- `document.body.scrollTop = 0`（body 未滚动）
- `rect.bottom`（来自 `getBoundingClientRect()`）随 div 滚动动态变化（总是 viewport-relative）
- `top = rect.bottom + 0 + offset` — 由于 body 无独立滚动，`rect.bottom` 本身就是正确的绝对坐标（相对于 body 内容原点）

同时 `setupVisibilityObserver` 会正确识别内部 div 为滚动容器并设置 IntersectionObserver 以控制可见性，防止在 div 外显示错位的 tooltip。

此场景在修复前后均正确，不受此次修改影响。

---

### 10. ✅ 副作用检查

修改仅限于 `positionTooltip()` 内的两个 `const` 赋值。`scrollX` 和 `scrollY` 均为函数局部变量，在此函数之外不可见，对其他公共 API (`showTranslationResult`, `updateTranslationResult`, `removeTranslationResult` 等) 无任何影响。

---

## 💡 建议

### S1 — 🔴 修复 Quirks Mode 双重计数（高优先级）

将当前的无条件加法改为条件加法：

```ts
// ✅ 建议方案：仅在 window 未发生滚动时才补充 body.scrollTop
const winScrollX = window.scrollX || document.documentElement.scrollLeft || 0
const winScrollY = window.scrollY || document.documentElement.scrollTop  || 0
const scrollX = winScrollX + (winScrollX === 0 ? (document.body?.scrollLeft || 0) : 0)
const scrollY = winScrollY + (winScrollY === 0 ? (document.body?.scrollTop  || 0) : 0)
```

此方案：
1. 在 Standards Mode 页面上行为与当前修复完全一致（body.scrollTop = 0）
2. 在 body-scroll 页面上正确补充 body.scrollTop（winScrollY = 0）
3. 在 Quirks Mode 下不会双重计数（winScrollY > 0 时 body 补充量为 0）
4. 同时修复 RTL 的 scrollLeft 负值场景

### S2 — 💬 更新注释以说明 Quirks Mode 排除逻辑

若采用 S1 方案，在代码注释中说明"winScrollY === 0 guard prevents double-counting in quirks-mode documents"，使维护者理解条件判断的必要性。

### S3 — 🧪 补充 Quirks Mode 测试用例（低优先级）

在 E2E 或单元测试中添加一个 Quirks Mode 测试页（无 DOCTYPE），验证 scrollY 公式不会双重计数。

---

## 结论

| 检查项 | 状态 | 说明 |
|---|---|---|
| body-scroll 页面正确性 | ✅ 通过 | 核心问题修复逻辑正确 |
| Standards Mode 普通页面兼容性 | ✅ 通过 | body.scrollTop = 0，加法无害 |
| Quirks Mode 兼容性 | ❌ 存在缺陷 | 可能双重计数，建议采用 S1 方案 |
| Scroll 监听器覆盖 body-scroll | ✅ 通过 | capture:true 可靠捕获 |
| Iframe 场景 | ✅ 通过 | 坐标系自洽 |
| RTL 水平滚动 | ⚠️ 低风险 | Firefox 负值 scrollLeft 的极端场景 |
| 内部 div 滚动容器 | ✅ 通过 | 无需此次修复介入，已有独立机制 |
| 双滚动容器理论场景 | ⚠️ 极罕见 | 理论风险，S1 方案可消除 |
| 副作用 | ✅ 无 | 变量局部，无外部影响 |

**总体结论**：修复方向正确，在主流现代页面上可以工作。建议在合并前应用 S1 所示的条件加法防御 Quirks Mode，使修复对所有页面类型均具有完整的鲁棒性。
