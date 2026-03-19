# Full-Page Translation — Code Review Report

**Date**: 2026-03-17  
**Reviewer**: AI Code Reviewer (Senior Chrome Extension Architect)  
**Scope**: `tapword-translator` (11_full_translate, content, background, popup) + `translate-api` (batch endpoint, token tracking)

---

## 🛡️ Review Summary

整体架构设计清晰——Walk → Observe → Batch → Render 的流水线合理且符合浏览器扩展的事件驱动本质。类型定义完整，模块边界明确，barrel exports 规范。代码风格和日志使用符合项目约定。

但在**关键清理路径**上发现一个严重的逻辑Bug：`stop()` 方法中 `DomBatcher.reset()` 的调用顺序导致所有清理操作（移除翻译内容、移除数据属性）被丢弃，用户点击"停止"后页面上的翻译内容和标记不会被实际清除。此外, Popup 按钮状态丢失、`sendSingleTranslation` 缺少错误处理等问题也需要关注。

后端 Batch API 实现合理，验证完备，Token 追踪逻辑正确。

---

## 🔴 HIGH ISSUES

### H-1: `stop()` 清理操作被 `DomBatcher.reset()` 完全丢弃

**File**: [PageTranslationManager.ts](src/11_full_translate/PageTranslationManager.ts#L113-L130)  
**Category**: Correctness / Resource Cleanup

`stop()` 方法的调用顺序为：

```
removeAllTranslations()       // 通过 DomBatcher.queue() 排入清理操作
removeWalkLabels()            // 通过 DomBatcher.queue() 排入清理操作
DomBatcher.getInstance().reset()  // 清空所有已排入的操作！
```

由于 `removeAllTranslations()` 和 `removeWalkLabels()` 都通过 `DomBatcher.queue()` 异步排入 DOM 操作（等待 `requestAnimationFrame` 执行），而 `reset()` 在同一同步执行上下文中立即清空了操作队列，因此：

1. **翻译内容不会被移除** — `.tapword-translated-content-wrapper` 元素永远留在页面上
2. **Walk 标签不会被移除** — `data-tapword-walked`、`data-tapword-paragraph` 等属性永远留在元素上
3. **translationOnly 模式下原始内容不会被恢复** — `restoreOriginalContent()` 排中的 innerHTML 还原操作同样被丢弃

**影响**: 用户点击 Popup 中的 "Stop" 按钮后，页面上的翻译结果和所有注入内容不会被清除。这是最核心的用户交互之一。

**建议修复**: 清理操作应绕过 DomBatcher 直接执行同步 DOM 操作，或将 `DomBatcher.reset()` 移到 cleanup 调用之前（先清空待执行的翻译渲染操作，再排入清理操作）：

```typescript
stop(): void {
    this.isRunning = false;
    // ... disconnect observers, clear queue ...
    
    // 1. First reset DomBatcher to discard pending translation renders
    DomBatcher.getInstance().reset();
    
    // 2. Then perform cleanup (these queue new ops into a fresh DomBatcher)
    removeAllTranslations();
    removeWalkLabels();
    
    // DO NOT reset DomBatcher again
    // ...
}
```

或更彻底的方案：让 `removeAllTranslations()` 和 `removeWalkLabels()` 提供同步执行模式，不经过 DomBatcher。

---

### H-2: `sendSingleTranslation()` 未检查 `chrome.runtime.lastError`，Promise 可能永远不 resolve/reject

**File**: [BatchQueue.ts](src/11_full_translate/utils/BatchQueue.ts#L168-L187)  
**Category**: Stability / Async Messaging

`sendSingleTranslation()` 使用 callback 形式的 `chrome.runtime.sendMessage()`：

```typescript
chrome.runtime.sendMessage(message, (response: FullTranslateBatchResponseMessage) => {
    if (response?.success && response.translations?.[0]) {
        resolve(response.translations[0]);
    } else {
        reject(new Error(response?.error ?? 'Translation failed'));
    }
});
```

如果 Service Worker 已失活或页面处于不可达状态，`chrome.runtime.lastError` 会被设置，但 callback 参数 `response` 为 `undefined`。当前代码会走到 `reject(new Error('Translation failed'))`，这其实能工作。

但更关键的问题是：**`chrome.runtime.lastError` 不被消费时，Chrome 会在控制台打印 "Unchecked runtime.lastError"** 警告。应在 callback 开头检查：

```typescript
chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
    }
    // ...
});
```

**注意**: 对比 `executeBatch()` 使用的 `await chrome.runtime.sendMessage(message)` — 这是 Promise 形式，会自动将 `lastError` 转为 rejection。两种风格不一致也增加了维护负担。

---

### H-3: Spinner 元素可能在 `stop()` 后残留在页面上

**File**: [PageTranslationManager.ts](src/11_full_translate/PageTranslationManager.ts#L113-L130), [renderer.ts](src/11_full_translate/dom/renderer.ts#L130-L134)  
**Category**: Resource Cleanup

`stop()` 中的清理操作只处理 `.tapword-translated-content-wrapper` 和 `data-tapword-*` 属性。Spinner 使用的 `.tapword-translate-spinner` class 不在清理范围内。

在正常流程中，`translateSimpleParagraph` 和 `translateMixedParagraph` 会在翻译完成或出错后移除 Spinner。但如果 `stop()` 在翻译进行中被调用：

1. `batchQueue.clear()` 拒绝所有 pending promises
2. `translateText()` 的 catch 块 return null
3. `translateSimpleParagraph` 的 catch 块调用 `removeSpinner(element)` — 这通过 `DomBatcher.queue()` 排入操作
4. 紧接着 `DomBatcher.getInstance().reset()` 清空该操作

结合 H-1 的 DomBatcher 问题，正在进行中的 Spinner 的清理操作也被丢弃。

**建议**: 在 `stop()` 中增加全局 Spinner 清理：
```typescript
document.querySelectorAll('.tapword-translate-spinner').forEach(s => s.remove());
```

---

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### A-1: [Sequential Processing] FullTranslateBatchHandler 逐个串行翻译，BatchQueue 的批量聚合优势大打折扣

**File**: [FullTranslateBatchHandler.ts](src/2_background/handlers/FullTranslateBatchHandler.ts#L38-L52)

Background handler 使用 `for` 循环逐个 `await translateModule.translateFragment()`，一个 batch 中 4 个文本必须等前一个完成后才翻译下一个。这意味着：

- 4 个文本 × 平均 1s/text = 4s 总耗时
- 如果使用 `Promise.allSettled`，4 个并行 = ~1s 总耗时

Content Script 侧的 `BatchQueue` 精心设计了累积和分批逻辑，但后端处理是串行的，前端等的时间是实际翻译时间的 N 倍。

**建议**: 将 `for` 循环改为 `Promise.allSettled` 并发执行，与后端 `translateBatch()` 的实现保持一致：
```typescript
const results = await Promise.allSettled(
    data.texts.map(text => translateModule.translateFragment({ ... }))
);
```

---

### A-2: [State Loss] Popup 按钮状态未持久化，重新打开 Popup 后状态丢失

**File**: [popup/index.ts](src/3_popup/index.ts#L107)

`setupFullTranslateButton()` 使用局部变量 `let isRunning = false`。Popup 关闭再打开时：

1. `isRunning` 重置为 `false`
2. 按钮显示 "Translate Page"（即使翻译仍在进行中）
3. 用户点击按钮 → 发送 `enabled: true` → `handleToggle(true)` → `manager.start()` → 先调用 `stop()` 再重新开始

这导致的行为是：**用户无法通过重新打开 Popup 来停止翻译**。每次点击都会重新开始翻译而不是停止。

**建议**: 在 Popup 初始化时查询当前翻译状态。可以通过 `chrome.storage.session` 存储运行状态，或新增一个 `FULL_TRANSLATE_STATUS_REQUEST` 消息类型来查询 Content Script 当前状态。

---

### A-3: [Graceful Degradation] TranslationCache SHA-256 在 HTTP 页面上静默失败

**File**: [TranslationCache.ts](src/11_full_translate/utils/TranslationCache.ts#L88-L93)

`crypto.subtle.digest('SHA-256', ...)` 仅在 **Secure Context**（HTTPS）下可用。在 HTTP 页面上，`crypto.subtle` 为 `undefined`，调用时会抛出 TypeError。

虽然 `get()` 和 `set()` 方法都有 try-catch 进行优雅降级（cache miss / skip），但这意味着 **HTTP 站点上缓存完全失效**，每次翻译都会发送 API 请求。没有日志提示这种降级。

**建议**: 在 `generateKey()` 中检测 `crypto.subtle` 可用性，不可用时回退到简单哈希（如 DJB2）。或在初始化时检测并记录一次警告日志。

---

### A-4: [Memory] `originalContentMap` 模块级 Map 持有强引用，可能导致 DOM 元素无法被 GC

**File**: [renderer.ts](src/11_full_translate/dom/renderer.ts#L33)

`const originalContentMap = new Map<Element, string>()` 使用 `Element` 作为 key（强引用）。在 SPA 页面中，如果 DOM 元素被路由切换移除但 `removeAllTranslations()` 未被调用，这些元素无法被垃圾回收。

**建议**: 改用 `WeakMap<Element, string>`，允许 GC 回收已移除的 DOM 元素。`removeAllTranslations()` 中的 `originalContentMap.clear()` 可保留作为显式清理。但注意 WeakMap 不可迭代——如有需要遍历的场景（当前没有），则需维护一个辅助的 WeakSet 或配合 `FinalizationRegistry`。但在当前设计中，restore 是通过 wrapper 的 parentNode 往上查找的，不需要遍历 map，所以 WeakMap 可行。

---

### A-5: [Performance] DynamicContentObserver 监听 attributes 变化可能过于频繁

**File**: [DynamicContentObserver.ts](src/11_full_translate/utils/DynamicContentObserver.ts#L13-L18)

配置 `attributes: true, attributeFilter: ['style', 'class', 'hidden'], subtree: true` 意味着页面上**任何元素**的 `style`、`class`、`hidden` 属性变化都会触发 mutation 回调。在动态 SPA（React/Vue 频繁更新 class）或有 CSS 动画（频繁 style 变化）的页面上，这会产生大量无用的 mutation records。

`shouldSkip()` 检查很快，但 `didBecomeVisible()` 调用 `window.getComputedStyle()` — 这是一个潜在的 layout 触发点。

**建议**: 考虑使用 debounce/throttle 处理 attribute mutations，或增加一个 `attributeOldValue: true` 配合 delta 检测来过滤无意义变更。

---

### A-6: [Edge Case] Walker 不计算 dont-walk-but-translate 元素为 inline 子节点

**File**: [walker.ts](src/11_full_translate/dom/walker.ts#L72-L81)

`walkAndLabelElement()` 的 Step 4 将 `isDontWalkIntoButTranslateAsChildElement` 元素（如 `<code>`、`<time>`）从 `validChildNodes` 中过滤掉。Step 5 仅对 `validChildNodes` 设置 `hasInlineNodeChild`。

边界情况：如果 `<p>` 仅包含 `<code>` 子元素（如 `<p><code>hello world</code></p>`），则 `hasInlineNodeChild` 为 `false`，该 `<p>` 不会被标记为 `PARAGRAPH_ATTRIBUTE`，因此不会参与翻译。

虽然实际中纯 `<code>` 段落较少见，但根据 README 说明 "Don't-walk-but-translate elements: their text IS included in parent paragraph"，这属于设计意图与实现的不一致。

---

### A-7: [Resilience] 后端批量翻译部分失败时返回空字符串，前端无用户反馈

**File**: [FullTranslateBatchHandler.ts](src/2_background/handlers/FullTranslateBatchHandler.ts#L47-L48), [PageTranslationManager.ts](src/11_full_translate/PageTranslationManager.ts#L250)

当批量翻译中某条文本失败时，Background handler push 空字符串 `""`。前端 `translateText()` 收到空字符串后，`if (translated)` 为 falsy，跳过 `insertTranslation`。

结果是：**失败的段落上什么也不显示，无 spinner、无错误提示、无译文**。用户无法知道该段落翻译失败了，会以为是"还在加载中"或"被跳过了"。

**建议**: 对失败的段落插入一个视觉提示（如红色标记或重试按钮），或至少 log 一条可见的 warning。

---

### A-8: [Contract Alignment] 前后端批量限制参数未对齐

**前端**:
- `DEFAULT_MAX_ITEMS_PER_BATCH = 4`
- `DEFAULT_MAX_CHARS_PER_BATCH = 1000`

**后端** ([translation.controller.ts](../../../project/translate-api/src/1_translate/controllers/translation.controller.ts)):
- `BATCH_MAX_TEXTS = 10`
- `BATCH_MAX_TOTAL_CHARS = 5000`

虽然前端限制更严格（4 < 10, 1000 < 5000），不会超过后端限制，但这两组常量完全独立维护，缺乏协调。如果未来有人调高前端限制而不知道后端限制的存在，可能导致请求被后端拒绝。

**建议**: 在某处文档化这个对齐关系，或考虑让后端返回自身限制参数供前端使用。

---

## 💡 SUGGESTIONS

### S-1: 统一 `async sendMessage` 风格

[BatchQueue.ts](src/11_full_translate/utils/BatchQueue.ts) 中 `executeBatch()` 使用 Promise 风格 `await chrome.runtime.sendMessage()`，`sendSingleTranslation()` 使用 callback 风格。建议统一为 Promise 风格，简化错误处理并消除 `lastError` 手动检查需求。

### S-2: 移除未使用的 `BATCH_SEPARATOR` 常量

[constants/index.ts](src/11_full_translate/constants/index.ts#L76) 定义了 `BATCH_SEPARATOR = "\u27E8\u27E9"` 但全代码库中未被引用。如果是为未来功能预留，应添加注释说明；否则应移除以保持代码整洁。

### S-3: `DomBatcher.reset()` 应取消已调度的 `requestAnimationFrame`

[DomBatcher.ts](src/11_full_translate/utils/DomBatcher.ts#L33-L38) 的 `reset()` 设置 `this.scheduled = false` 但没有调用 `cancelAnimationFrame()`。虽然 rAF 回调执行时操作队列已清空不会产生副作用，但显式取消更干净。需要保存 rAF ID：
```typescript
private rafId: number | null = null;
// In scheduleFlush:
this.rafId = requestAnimationFrame(() => this.flush());
// In reset:
if (this.rafId !== null) cancelAnimationFrame(this.rafId);
```

### S-4: `TokenBucketRateLimiter` 可考虑队列化 acquire 请求

当多个 `acquire()` 同时等待时，它们各自计算 `waitMs` 并独立 sleep。唤醒后的竞争可能导致 token 暂时为负值。可以用 FIFO 队列排序 acquire 请求，确保严格按序消费 token。对当前负载来说非本质问题，但如果扩展流量增长可考虑。

### S-5: 后端 `rawUsage` 类型安全

[generationLLM.service.ts](../../../project/translate-api/src/7_generate/services/llm/generationLLM.service.ts#L82) 中 `const rawUsage = completion.usage as any` 使用了 `as any` 类型断言。OpenAI SDK 的 `completion.usage` 实际上是有类型的 (`CompletionUsage`), 包含 `prompt_tokens`, `completion_tokens`, `total_tokens`。建议使用 SDK 自带类型代替 `as any`：
```typescript
const rawUsage = completion.usage;
if (rawUsage) {
    tokenUsage = {
        promptTokens: rawUsage.prompt_tokens ?? 0,
        completionTokens: rawUsage.completion_tokens ?? 0,
        totalTokens: rawUsage.total_tokens ?? 0,
    };
}
```

### S-6: `TranslationUnit.nodes` 数组中的 Node 引用在 DOM 变更后可能失效

[translationWalker.ts](src/11_full_translate/dom/translationWalker.ts#L36-L84) 提取的 `TranslationUnit.nodes` 持有对 DOM Node 的引用。如果在翻译期间 `DynamicContentObserver` 检测到 DOM 变更，这些 Node 引用可能指向已被移除的节点。`translateUnit()` 使用 `unit.nodes[unit.nodes.length - 1]` 作为 `insertAfterNode`，如果该节点已不在 DOM 中，`insertBefore()` 会抛出 DOMException。建议添加 `lastNode.parentNode` 存在性检查。

---

## 📊 Issue Summary

| Severity | Count |
|----------|-------|
| 🚨 CRITICAL | 0 |
| 🔴 HIGH | 3 |
| 🧠 ARCHITECTURAL | 8 |
| 💡 SUGGESTIONS | 6 |

**最高优先级修复项**: H-1 (`stop()` 清理失效) — 这是影响核心用户交互的功能性 Bug。
