# Interactive Priority Code Review

**审查日期**: 2026-03-13
**审查范围**: `editableElementDetector.ts` 重构 + `hitTesting.ts` 强/弱交互优先级逻辑
**Manifest**: `manifest__interactive-priority_2026-03-13.md`

---

## 🛡️ Review Summary

本次变更包含两部分：

1. **`editableElementDetector.ts` 重构** — 将原有的 `isInteractiveElement()` 布尔返回值提升为结构化的 `classifyInteractiveElement()`，暴露 `strong`/`weak` 分级、原因、以及文本例外标记。同时将类型签名从 `HTMLElement` 扩展到 `Element`，解决 SVG 元素（`<svg>`, `<path>` 等）在 `composedPath` 遍历中被跳过的问题。
2. **`hitTesting.ts` 交互优先级** — 在捕获阶段的 click/dblclick 处理中接入分类结果，实现四级优先级链：扩展 UI > strong host > translation hit zone > weak host。

**整体评价**: 重构设计清晰，向后兼容性好（`isInteractiveElement` 保持为薄包装器），SVG 修复正确，类型安全通过编译验证。存在一个中等风险的传播语义不一致和一个低风险的不可交互翻译问题，无 CRITICAL/HIGH 级别违规。

---

## 🚨 CRITICAL / 🔴 HIGH ISSUES

**无。**

- ✅ 无远程代码执行、`eval`、`innerHTML` 注入
- ✅ 无硬编码密钥
- ✅ Service Worker 无全局状态依赖
- ✅ `return true` 消息模式未被破坏（本次变更不涉及 messaging）
- ✅ 无 `any` 类型泄漏
- ✅ 事件监听器有对应的 `detach` 清理路径
- ✅ `npm run type-check` 通过

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### 1. [Propagation Asymmetry — 中等风险] handleClick vs handleDblClick 的 stopPropagation 行为不一致

**现象**:
- `handleClick` 对 weak interactive 目标 **条件性跳过** `stopPropagation()`，允许宿主页面 click handler 共同运行
- `handleDblClick` 对 weak interactive 目标 **无条件调用** `stopPropagation()` + `preventDefault()`

**分析**:
这意味着在 weak interactive 容器（如带 `onclick` 属性的 div）内的翻译区域：
- 单击 → 翻译 modal 打开 **且** 宿主 click handler 执行（共存）
- 双击 → 翻译被移除 **但** 宿主 dblclick handler 被阻断

对于双击移除场景，无条件阻断传播是合理的（需要清除选区、避免语义冲突），但这一设计决策应当显式文档化，避免维护者误认为是遗漏。

**建议**: 在 `handleDblClick` 的 `e.stopPropagation()` 处添加注释，解释为何双击路径不像单击路径那样条件化处理传播。

### 2. [Inaccessible Translations — 低风险] Strong Interactive 表面上的翻译无法通过点击交互

**现象**:
当翻译注释视觉上覆盖 strong interactive 表面（如 Twitter 信息流卡片、可点击链接区域）时，strong interactive 优先级导致 click 和 dblclick 都直接 `return`。翻译仍可见（tooltip 正常渲染），但用户无法：
- 单击打开详情 modal
- 双击移除翻译

**影响**: 用户需要刷新页面或滚动后等待 orphan 检测来清除这些翻译。在 Twitter 信息流等 cursor:pointer 大面积覆盖的场景中较为明显。

**评估**: 这是有意的设计取舍 — 保护原生交互优先于翻译交互。但应确认产品层面是否接受此限制，或是否需要提供备用的移除机制（如右键菜单、键盘快捷键）。

### 3. [SVG Fix — 正确] HTMLElement → Element 类型扩展

**变更点**:
- `getElementFromTarget`: `instanceof HTMLElement` → `instanceof Element`
- `isInteractiveElementSelf`, `isInteractiveElementByClosest`, `getStrongInteractiveResult`, `getWeakInteractiveResult`: 参数从 `HTMLElement` 改为 `Element`
- `isTextContentException`: 参数从 `HTMLElement` 改为 `Element`

**验证**:
- `window.getComputedStyle()` 接受 `Element` 参数 ✅
- `element.matches()` / `element.closest()` / `element.hasAttribute()` 均为 `Element` 方法 ✅
- `element.isContentEditable` 在 `isDirectlyEditable` 中仍有 `instanceof HTMLElement` 守卫 ✅
- `Element.parentElement` 在 `isInteractiveElementByClosest` 的 while 循环中返回 `HTMLElement | null`，赋值给 `Element | null` 类型变量，类型兼容 ✅

**旧行为 vs 新行为**:
- 旧代码：点击 `<svg>` → `getElementFromTarget` 返回 `null` → `isInteractiveElement` 返回 `false` → 翻译 click 处理照常进行（即使 SVG 在按钮内）
- 新代码：点击 `<svg>` → 返回 SVGElement → composedPath 遍历找到父级 `<button>` → 分类为 strong → 翻译 click 被跳过

符合修复意图 ✅

### 4. [Side Effects — 安全] isInteractiveElement 对外行为未变

`isInteractiveElement()` 现在是一个薄包装器：
```typescript
export function isInteractiveElement(...): boolean {
    return classifyInteractiveElement(...).isInteractive
}
```

所有外部调用点（`selectionValidator.ts` L223, `TranslationPipeline.ts` L54）使用的仍然是布尔 API。分类逻辑的内部重构不改变该布尔值的语义 — `isInteractive` 的 `true`/`false` 判定条件与原始实现一致。

唯一的行为差异来自 SVG 修复：原本因 `instanceof HTMLElement` 过滤而返回 `false` 的 SVG 目标，现在可能返回 `true`。这是 **有意的修复**，不是副作用。

### 5. [Weak Interactive Text Exception — 正确] 弱交互容器的文本例外行为保持一致

**路径分析**:
1. composedPath 遍历找到 weak interactive 节点（如 `div[onclick]`）
2. 检查 `isTextContentException(element)`（element 是点击目标）
3. 如果目标 cursor 在 `["text", "auto", "default"]` 中 → 文本例外生效 → `{ isInteractive: false, ignoredAsTextException: true }`
4. 在 `hitTesting.handleClick` 中，文本例外与 weak level 共同触发跳过 `stopPropagation`

条件表达式 `!(interaction.level === "weak" || interaction.ignoredAsTextException)` 正确覆盖了三种场景：
- 纯非交互（`level: undefined`）→ 调用 stopPropagation ✅
- Weak 交互（`level: "weak", isInteractive: true`）→ 跳过 stopPropagation ✅
- 文本例外（`level: "weak", ignoredAsTextException: true`）→ 跳过 stopPropagation ✅

### 6. [Double-Click Removal — 正确] 普通翻译文本的双击移除路径

对于非交互元素上的翻译文本（最常见场景）：
1. `classifyInteractiveElement` → `{ isInteractive: false }`
2. 不触发 strong bail-out
3. `findHitTranslationByPoint` 命中翻译区域
4. `stopPropagation` + `preventDefault` 阻止浏览器原生选词
5. `onTranslationDblClick` → `removeTranslationResult` + `removeAllRanges`

流程完整 ✅

---

## 💡 SUGGESTIONS

### S1. 提取 stopPropagation 条件为命名函数

当前 `handleClick` 中的条件：
```typescript
if (!(interaction.level === "weak" || interaction.ignoredAsTextException)) {
    e.stopPropagation()
}
```

建议提取为自文档化的辅助函数：
```typescript
function shouldStopClickPropagation(interaction: InteractiveElementClassification): boolean {
    return interaction.level !== "weak" && !interaction.ignoredAsTextException
}
```

### S2. InteractiveElementClassification 可考虑判别联合类型

当前接口使用可选字段，导致消费方需要组合检查多个字段。更精确的类型设计：
```typescript
type InteractiveClassification =
    | { isInteractive: true; level: "strong" | "weak"; reason: string; element: Element }
    | { isInteractive: false; ignoredAsTextException: true; level: "weak"; reason: string; element: Element }
    | { isInteractive: false; ignoredAsTextException?: false }
```
这样 TypeScript 可以在 narrowing 后自动推断可用字段。此为长期优化建议，不阻塞本次合入。

### S3. hitTesting.ts 中 `e.target as Element` 的防御性检查

```typescript
const target = e.target as Element
if (target.closest(OWN_UI_SELECTOR)) return
```

虽然鼠标事件的 `e.target` 在实践中总是 `Element`，但类型断言绕过了编译器保护。可添加运行时守卫：
```typescript
const target = e.target
if (!(target instanceof Element)) return
if (target.closest(OWN_UI_SELECTOR)) return
```

### S4. 考虑在 dblclick 路径也添加 weak interactive 条件化传播

如果产品需求允许，可以让 `handleDblClick` 对 weak interactive 元素也采用条件化的 `stopPropagation`，保持与 `handleClick` 的对称性。当前的非对称行为虽然有合理理由，但增加了认知负担。

---

## ✅ Manifest Risk Checklist

| Risk Item | Status | Notes |
|---|---|---|
| Logical Consistency: click priority contract | ✅ Pass | Extension UI > strong host > translation > weak host 四级优先级正确实现 |
| Side Effects: single-click translation behavior | ✅ Pass | `isInteractiveElement` 布尔 API 语义不变，仅 SVG 修复是有意行为变更 |
| SVG/Non-HTMLElement handling | ✅ Pass | `Element` 类型正确覆盖 SVG 节点，composedPath 遍历可达父级交互元素 |
| Weak Interactive text-exception | ✅ Pass | cursor allowlist 检查和文本例外逻辑保持一致 |
| Propagation Semantics | ⚠️ Note | click 条件化 vs dblclick 无条件化存在不对称，功能正确但需文档化 |
| Double-Click Path | ✅ Pass | 普通文本上双击移除正常工作；strong 元素上双击被跳过是有意设计 |
