# TapWord Translator Staged Review Report

**Date**: 2026-03-15  
**Reviewer**: Codex  
**Scope**: `git staged` changes in `tapword-translator` only  
**Excluded**: backend / `translate-api` related changes

## 🛡️ Review Summary

本次 staged 变更已经把全页翻译的主链路搭建出来，模块边界也基本遵循了 `Walk → Observe → Batch → Render` 的设计方向。  
但当前实现仍有几个高风险问题，主要集中在以下三个方面：

- `translationOnly` 模式对宿主页 DOM 的改动方式不安全
- 动态内容观察没有完整继承初始遍历时的 skip 规则
- 全页翻译生命周期没有接入现有 SPA 导航清理机制

这些问题大多不会被 TypeScript 类型系统发现，但会在真实网页环境中表现为页面行为损坏、被显式排除的内容被错误翻译、以及路由切换后仍持续工作的幽灵翻译会话。

当前结论是：这组 staged 改动的整体方向可行，但还不适合直接视为稳定可交付状态。

## 🚨 CRITICAL / 🔴 HIGH ISSUES

### 1. [High] `translationOnly` 模式通过 `innerHTML` 重建宿主页 DOM，破坏页面运行时状态

**位置**
- [renderer.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/dom/renderer.ts#L200)

**问题描述**

`applyTranslationOnlyMode()` 会先保存 `paragraphElement.innerHTML`，然后执行：

```ts
paragraphElement.innerHTML = '';
paragraphElement.appendChild(wrapperSpan);
```

停止翻译时又会通过 `innerHTML` 恢复原内容。

这种做法对于 content script 所运行的宿主页来说风险很高，因为它不是“视觉替换”，而是在重建宿主页子树。重建后的 DOM 节点与原节点不再是同一批对象，常见副作用包括：

- 框架绑定断裂，例如 React / Vue / Svelte 管理的节点失去内部状态
- 宿主页通过 `addEventListener` 绑定的监听器丢失
- 表单值、焦点、媒体播放状态、展开状态被重置
- 依赖 DOM identity 的第三方组件出现不可预期行为

这类破坏即使在调用 `stop()` 之后也不会自动恢复，因为恢复出来的是新的 DOM，而不是原来的运行时对象。

**影响**

- 直接破坏宿主页功能
- “翻译后恢复原状”的承诺不成立
- 在复杂 SPA 或富交互页面上风险非常高

**建议**

避免用 `innerHTML` 重建宿主页内容。  
更稳妥的方向是：

- 保持原节点不动，仅隐藏原文并插入翻译层
- 或基于独立 wrapper / overlay 做可逆渲染
- 停止时只撤销 TapWord 自己插入的节点和样式，不重建宿主页子树

---

### 2. [High] 动态新增内容没有继承“祖先 skip 区域”规则，可能错误翻译被排除区域

**位置**
- [DynamicContentObserver.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/utils/DynamicContentObserver.ts#L95)
- [DynamicContentObserver.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/utils/DynamicContentObserver.ts#L120)
- [filter.ts](/Users/hongyuan/project/v2/tapword-translator/src/11_full_translate/dom/filter.ts#L149)

**问题描述**

`DynamicContentObserver.shouldSkip()` 当前只判断三件事：

- 当前节点是否已经属于本轮 walk
- 当前节点是否是 TapWord 注入的 wrapper
- 当前节点是否位于 TapWord wrapper 内部

但它没有判断该节点是否位于一个本来就不应该被翻译的祖先区域内部。  
例如以下区域在初始 walk 中应被排除：

- `.notranslate`
- `<code>`
- 被隐藏或 `aria-hidden` 的区域
- 各站点自定义 skip selector 命中的区域

项目里其实已经提供了 `hasNoWalkAncestor()`，README 也明确说明 DynamicContentObserver 应该利用祖先 skip 信息，但当前实现没有接入这层判断。

这会导致一个重要语义偏差：

1. 初始页面加载时，某个区域因为祖先规则被排除
2. 后续该区域内部动态插入了新的子节点
3. observer 从“新增子节点”这个根重新开始 walk
4. 因为没有检查祖先 skip 规则，这批内容被错误纳入翻译流程

**影响**

- 被显式声明为“不翻译”的区域在动态更新后被错误翻译
- code / notranslate / 特定站点屏蔽区域的约束不再可靠
- 动态页面上的行为与初始页面行为不一致，调试难度高

**建议**

在 `shouldSkip()` 中补充祖先级别判断，至少覆盖：

- `hasNoWalkAncestor(element, range)`
- 站点级 skip 区域
- 与初始 walk 一致的隐藏 / 不可翻译语义

目标应当是：动态内容的可翻译性判断与初始全量遍历保持同一套规则。

---

### 3. [High] 全页翻译会话未接入 SPA 导航生命周期，路由切换后仍可能持续运行

**位置**
- [FullTranslateHandler.ts](/Users/hongyuan/project/v2/tapword-translator/src/1_content/handlers/FullTranslateHandler.ts#L28)
- [index.ts](/Users/hongyuan/project/v2/tapword-translator/src/1_content/index.ts#L114)
- [SpaNavigationHandler.ts](/Users/hongyuan/project/v2/tapword-translator/src/1_content/handlers/SpaNavigationHandler.ts#L33)

**问题描述**

`PageTranslationManager` 被保存在 content script 模块级变量 `manager` 中，只有显式 toggle 时才会 `start()` / `stop()`。  
但现有 SPA 导航清理逻辑只处理了旧的选词翻译 UI：

- `translationDisplay.removeAllTranslationResults()`
- `iconManager.removeTranslationIcon()`
- 清理 selection

它没有通知全页翻译模块停止当前会话，也没有清除全页翻译专用的 observer、walk 标记与注入节点。

这意味着在 YouTube、GitHub、Discord 这类 SPA 页面上，如果用户开启全页翻译后发生路由切换：

- `manager` 仍然保持运行态
- 旧 observer 可能继续监听并处理新页面内容
- popup 状态查询仍会认为当前页面“正在翻译”
- 已注入的全页翻译 wrapper 不受现有导航清理逻辑控制

**影响**

- 路由切换后出现幽灵翻译状态
- 会话边界与页面边界不一致
- 后续问题排查会非常困难，因为用户看到的是“新页面”，但运行的是“旧会话”

**建议**

为全页翻译增加显式的 navigation cleanup 接口，并接入 `SpaNavigationHandler`。  
至少需要保证：

- 路由切换时停止当前 `PageTranslationManager`
- 清理 full-translate 专属 DOM 注入和 walk 标记
- 若产品期望跨路由持续翻译，也应明确重新启动一个新 session，而不是复用旧 session

## 🧠 ARCHITECTURAL & LOGIC INSIGHTS

### [Resilience] 当前 `translationOnly` 实现违反了 content script 的宿主隔离原则

Content script 面对的不是受控 DOM，而是任意第三方页面。  
在这种环境里，任何基于 `innerHTML` 的大范围替换都应默认视为高风险操作，因为它破坏了宿主页自己的运行时语义，而不是只附加 TapWord 自己的显示层。

### [Consistency] 动态内容与初始遍历使用了两套不同的排除语义

初始 walk 的 skip 判定较完整，但 DynamicContentObserver 的再接入判定明显更窄。  
这会导致“同一个区域，初始加载时不翻，动态更新后又翻”的不一致行为。对用户来说，这类问题通常比稳定性 bug 更难理解。

### [Lifecycle] 全页翻译目前缺少与页面导航同级别的会话边界

已有项目已经为选词翻译实现了 SPA 导航清理机制，说明代码库本身已经承认“页面切换 = 需要回收注入状态”。  
全页翻译作为更重的 DOM/observer 注入模块，没有接入这套生命周期，是当前架构上的明显缺口。

## 💡 Suggestions

- 用“只撤销 TapWord 自己插入的节点和样式”的方案替代 `innerHTML` 重建。
- 把 DynamicContentObserver 的 skip 逻辑与初始 walker 的 skip 逻辑统一起来。
- 为全页翻译增加显式 `disposeForNavigation()` 或等价接口，并由 SPA 导航清理统一调用。
- 后续如果继续深入 review，建议优先再检查：
  - `stop()` 后已在飞行中的异步批量请求是否还可能回写页面
  - `DomBatcher.reset()` 与已调度 `requestAnimationFrame` 的竞态
  - Shadow DOM observer 的重复注册与回调放大问题

## Verification Notes

- 已阅读 review rule 与 review manifest
- 已按模块 README 建立上下文后再审查代码
- 本文仅覆盖 `tapword-translator` staged 改动
- backend / `translate-api` 未纳入本次报告
