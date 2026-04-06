# TapWord Translator Staged Code Review

**Date**: 2026-03-15  
**Scope**: `git staged` changes in `tapword-translator` only  
**Excluded**: backend / `translate-api` related changes

## 🛡️ Review Summary

本次 staged 变更已经把全页翻译的主链路搭起来了，模块拆分也基本符合 `Walk → Observe → Batch → Render` 的设计方向，`README` 与实现的大方向也一致。  
但当前实现仍存在几个高风险行为缺陷，主要集中在 **生命周期收敛**、**动态内容覆盖率**、以及 **Popup → Background → Content 的消息容错**。这些问题不会被 TypeScript 类型检查拦住，但会在真实 MV3 运行环境中直接表现为“停止后仍继续插入翻译”、“SPA 动态新增内容漏翻”、“某些页面点击按钮直接报错或卡死”。

本次 review 未发现新增的明显安全红线问题，但现阶段还不适合把这组改动视为稳定可交付状态。

## 🚨 CRITICAL / 🔴 HIGH ISSUES

### 1. [High] 停止翻译后，已发出的异步请求仍可能继续回写 DOM

**位置**
- [PageTranslationManager.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/PageTranslationManager.ts#L116)
- [PageTranslationManager.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/PageTranslationManager.ts#L223)
- [PageTranslationManager.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/PageTranslationManager.ts#L291)
- [PageTranslationManager.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/PageTranslationManager.ts#L314)

**问题描述**

`stop()` 只做了以下几件事：
- 断开 observer
- `batchQueue.clear()`
- 清除现有翻译 DOM
- `walkId = null`

但它没有真正取消那些已经从 `BatchQueue.flush()` 发出去、正在等待 background 返回的请求。  
`translateText()` 只在 `await this.batchQueue.enqueue(text)` **之前**检查了一次 `isRunning` / `batchQueue`，而在请求返回之后，`translateSimpleParagraph()` 与 `translateUnit()` 会直接调用 `insertTranslation(...)`。

这意味着以下时序会出错：
1. 用户开启全页翻译
2. 某批请求已经发往 background
3. 用户立刻点击停止，`removeAllTranslations()` 清掉当前结果
4. 旧请求晚一点返回
5. 内容脚本继续把旧翻译插回页面

如果用户是“停止后立刻重新开始，并切换目标语言”，旧 session 的结果甚至可能污染新 session。

**影响**

- “停止翻译”语义不成立
- 配置热更新可能混入旧语言结果
- DOM 清理与重新注入互相打架，出现幽灵翻译

**建议**

至少补一层 session 校验：
- 在 `translateText()` 返回后再次校验当前 `walkId` / `isRunning`
- 在 `translateSimpleParagraph()` / `translateUnit()` 插入前再次确认 element 仍属于当前 session
- 最稳妥的做法是把当前 session id 作为异步链路上下文显式传递，返回后比对，不一致则丢弃结果

---

### 2. [High] 动态内容观察漏掉“新增根节点本身就是 paragraph”的场景

**位置**
- [PageTranslationManager.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/PageTranslationManager.ts#L359)
- [PageTranslationManager.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/PageTranslationManager.ts#L372)

**问题描述**

`walkAndObserve(element)` 会先对传入的新增节点做 `walkAndLabelElement(element, ...)`，然后调用：

```ts
const allParagraphs = this.collectParagraphs(element)
```

而 `collectParagraphs(root)` 的实现是：

```ts
root.querySelectorAll(...)
```

`querySelectorAll()` **不会包含 `root` 自身**。  
所以如果 SPA 直接插入：

```html
<p>new content</p>
```

或者某个原本隐藏的 paragraph 根节点被显示出来，那么它虽然会被 walk 并打上 `data-tapword-paragraph`，但不会被收集到，也就不会进入 `IntersectionObserver.observe(...)`。

**影响**

- 动态新增内容不是“部分漏翻”，而是某些根节点完全不翻
- 这会直接削弱 `DynamicContentObserver` 的核心价值，特别是在 feed、chat、timeline、评论区场景

**建议**

`collectParagraphs(root)` 需要显式包含 root 自身，例如：
- 先判断 `root.matches(selector)` 再合并 `querySelectorAll`
- 或者改成统一的 tree traversal，不依赖 `querySelectorAll` 的“只取后代”语义

---

### 3. [High] Popup 切换全页翻译时，对“目标 tab 无 content script”没有做容错

**位置**
- [MessageRouter.ts](/Users/hongyuan/project/v2/tapword-translator/src/2_background/messaging/MessageRouter.ts#L75)
- [index.ts](/Users/hongyuan/project/v2/tapword-translator/src/3_popup/index.ts#L121)

**问题描述**

Background 在处理 `FULL_TRANSLATE_TOGGLE` 时，直接把 popup 的 `sendResponse` 透传给：

```ts
chrome.tabs.sendMessage(tabs[0].id, message, sendResponse)
```

这里没有处理两类常见失败：
- 当前页面不允许注入 content script，例如 Chrome 内置页、Web Store
- 内容脚本尚未就绪，`sendMessage` 触发 `chrome.runtime.lastError`

在这种情况下，popup 侧回调里的 `response` 可能是 `undefined`，但当前代码会直接读取：

```ts
isRunning = response.isRunning
```

这会导致 popup 自己抛异常。

**影响**

- 用户在不支持注入的页面点击按钮会直接出错
- popup 可能卡在 loading/状态回滚异常
- 消息链路缺少明确 contract，后续难以扩展“查询当前运行态”等能力

**建议**

Background 侧：
- 在 `chrome.tabs.sendMessage` 的 callback 里检查 `chrome.runtime.lastError`
- 统一返回结构化错误响应，而不是依赖 callback 被动透传

Popup 侧：
- 在读取 `response.isRunning` 前先校验 `response`
- 对无 receiver 场景展示明确的失败状态，而不是只依赖 `lastError`

## 🧠 Architectural & Logic Insights

### [Lifecycle] 目前的 session 设计只覆盖了 walker 标记，没有完整覆盖异步回写阶段

`walkId` 已经被用于标记和过滤 DOM，这是正确方向。  
但 session 隔离要成立，必须覆盖整条异步链路：

- 进入 viewport
- 排队
- background 翻译
- 返回 content
- render

现在只覆盖了前半段，后半段仍可能把旧 session 的结果写回页面，所以这个 session 模型还没闭合。

### [Dynamic Content] Dynamic observer 已经存在，但 paragraph 重新接入观察链路不完整

`DynamicContentObserver` 的存在说明设计目标是支持 SPA / 流式内容。  
但只要新增内容的 paragraph 恰好出现在 mutation root，本次实现就会漏掉。也就是说“发现新内容”和“重新挂接 observer”之间还缺一个严密的桥。

### [Popup State] 当前按钮状态是纯本地瞬时状态，不是扩展真实状态

`setupFullTranslateButton()` 中的 `isRunning` 是 popup 内局部变量。  
popup 一旦关闭再打开，这个状态就会重置，即使页面仍在翻译，按钮也会显示为未启动。

这条不是本次最严重的问题，但它暴露出当前设计还没有建立：
- “页面翻译运行态”存放在哪里
- popup 如何读取真实运行态
- 多次打开 popup 如何与 content 当前状态对齐

如果后续要补“状态查询”能力，建议不要再继续堆本地 UI 状态，而是把 toggle / query 做成清晰的消息协议。

## 💡 Suggestions

- 给全页翻译链路补一个显式的 session token，并在 render 前做最终校验。
- 修正 `collectParagraphs(root)` 的 root-self 漏洞，否则 SPA 支持会长期不稳定。
- 为 `FULL_TRANSLATE_TOGGLE` 增加“查询当前状态”消息，popup 初始化时主动同步真实状态。
- Background 转发消息时统一包装错误响应，不要把 `sendResponse` 直接裸透传给 `chrome.tabs.sendMessage`。
- 后续如果继续深化 review，优先再检查：
  - `translatingNodes` 是否会导致一次失败后永久不再重试
  - `DomBatcher.reset()` 与已调度 `requestAnimationFrame` 的竞态
  - `TranslationCache` 在不安全上下文 / 特殊页面中的可用性退化路径

## Verification Notes

- 已阅读本次 review manifest 与 review rule
- 已按模块 README 建立上下文后再审查代码
- 已执行 `npm run type-check`
- 本文仅覆盖 `tapword-translator` staged 改动，不包含 backend
