# Code Review Report — m03-token-prefetch

**Review Date**: 2026-03-07 15:00  
**Reviewer**: GitHub Copilot (Claude Sonnet 4.6)  
**Manifest**: `docs/plan/y2026/m03-token-prefetch/review/260307_1400_manifest.md`  
**Overall Verdict**: 🔴 **FAIL**

---

## 🛡️ Review Summary

本次变更旨在通过 `PAGE_ACTIVATED` 消息机制，在用户打开任意页面时让 Background Service Worker 提前预热 JWT Token，消除首次翻译的延迟。

实现思路是正确的：架构上将预热逻辑拆分为 `TokenWarmUpHandler`、修改 `MessageRouter` 路由、在 `content/index.ts` 的 `init()` 最开头发送 fire-and-forget 消息，逻辑清晰，边界明确。但经过逐行比对 Service Worker 的初始化时序，发现了一个**结构性竞态条件**：在 SW 冷启动场景（即最典型的"用户首次打开页面"场景）下，预热消息**始终**在 `AuthService` 初始化完成之前被处理，导致 warm-up 被静默跳过——即本功能在最重要的 use case 下完全失效。

此外，对已在 `startAutoRefresh()` 中修复的 else 分支、`refreshPromise` 去重逻辑、多 tab 并发、错误处理等各方面进行了独立验证，这些实现均正确，只有上述冷启动竞态问题需要解决。

---

## 🚨 CRITICAL ISSUES

### [C-1] 冷启动竞态：`PAGE_ACTIVATED` 始终早于 `AuthService` 初始化完成

**文件**: `src/2_background/index.ts` + `src/2_background/handlers/TokenWarmUpHandler.ts`

**问题根因**（逐步推导）：

```
background/index.ts → initialize():
  1. MessageRouter.setupMessageListener()   ← 同步，立即注册 listener
  2. await ServiceInitializer.initializeServices()  ← 异步，首先 await getDeviceUID() (storage read)
     ↑ 在 await 处 yield 事件循环
     ↑ 此时已排队的 PAGE_ACTIVATED 消息被 dispatch

content/index.ts → init():
  1. chrome.runtime.sendMessage(PAGE_ACTIVATED)   ← 唤醒 SW
  2. await initializeUserSettings()               ← 异步
  3. 注册事件监听器
```

由于 `MessageRouter.setupMessageListener()` 在 `initializeServices()` 之前执行（设计上为了"尽早接收消息"），当 SW 被唤醒后：

1. `setupMessageListener()` 同步执行完毕，listener 注册好
2. `await initializeServices()` 开始执行，进入 `initializeAPIService()`
3. `initializeAPIService()` 立即碰到 `await getDeviceUID()` → **yield 事件循环**
4. 事件循环处理已排队的 `PAGE_ACTIVATED` 消息
5. `TokenWarmUpHandler.handlePageActivated()` 调用 `authService.isInitialized()` → **返回 FALSE**（`initAuthService` 还没被调用）
6. Handler 返回 `{ status: "not_initialized" }`，**预热被完全跳过**
7. 之后 `initializeServices()` 才完成，`startAutoRefresh()` 被启动（5 分钟定时器）

**结论**：在 SW 冷启动场景（最常见的"首次打开页面"场景）下，`PAGE_ACTIVATED` 预热**始终**失败，功能的核心目标未达成。

**影响范围**：
- 用户早上打开浏览器进入任意页面（SW 被 Chrome 回收了） → 首次翻译仍延迟
- 用户超过 30 秒未使用扩展后打开新页面 → 首次翻译仍延迟

**最小修复方案**：在 `initializeServices()` 完成后立即主动调用一次 `getToken()`，使 SW 初始化完成后立即预热 Token（与 `PAGE_ACTIVATED` 路径互为补充）：

```typescript
// background/index.ts → initialize()
MessageRouter.setupMessageListener()
await ServiceInitializer.initializeServices()

// 立即预热：解决冷启动、SW 复活时已打开 tab 的 token 缺失问题
import { getAuthService } from "@/5_backend"
getAuthService().getToken().catch((err) => {
    logger.warn("Initial token pre-warm failed (non-fatal):", err)
})
```

配合 `refreshPromise` 去重机制，此调用与并发 `PAGE_ACTIVATED` 触发的 `getToken()` 是安全的——后来者会等待同一个 Promise。

---

## 🔴 HIGH ISSUES

### [H-1] 已打开 tab 在 SW 复活后无法触发预热

**问题**：`PAGE_ACTIVATED` 仅在 content script **页面加载时** 发送一次（`init()` 内）。如果一个 tab 是在 SW 活跃时打开的，之后 SW 被 Chrome 回收，再次复活时：

- 无任何机制触发新的 `PAGE_ACTIVATED`
- `startAutoRefresh()` 的定时器需等待 5 分钟才会主动刷新
- 该 tab 上的首次翻译（SW 复活后）仍会带有全量 token 获取延迟

此问题同样被 [C-1] 提出的修复方案所覆盖：在 `initializeServices()` 之后立即 `getToken()` 即可解决。

---

## ✅ 验证通过项

以下各项经逐行检查，实现正确：

### [OK-1] 消息时序（Warm Start 场景）
**结论**：在 SW 已存活（Warm Start）场景下，`PAGE_ACTIVATED` 确实先于用户可能触发翻译到达。`init()` 在注册 `dblclick`/`click`/`mouseup` 事件监听器**之前**先 await `initializeUserSettings()`，而 `PAGE_ACTIVATED` 在 `initializeUserSettings()` 执行前就已发出。时序保证成立（仅限 Warm Start）。

### [OK-2] `return true` 语义
`TokenWarmUpHandler.handlePageActivated()` 在所有代码路径（`not_initialized` 早返回、正常 `warming` 路径）中均**同步**调用 `sendResponse`。`MessageRouter` 中的 `return true` 虽技术上冗余（channel 的响应已在 `return true` 执行前被发出），但无害，且与其他 case 保持一致。无消息通道泄漏风险。✓

### [OK-3] 多 Tab 并发去重
3 个 tab 同时打开 → 3 条 `PAGE_ACTIVATED` 消息。由于 JS 单线程，它们的 `handlePageActivated` 依次执行：
- 第 1 条：`refreshPromise` 为 null → `fetchNewToken()` 启动，`refreshPromise` 被设置
- 第 2 条：`refreshPromise` 不为 null → `return await this.refreshPromise`（复用同一 Promise）
- 第 3 条：同第 2 条

`refreshPromise` 在 `finally` 块中置 null，不会卡死。✓

### [OK-4] `startAutoRefresh()` else-branch 修复正确性
修复后的 else 分支调用 `this.getToken()`，`getToken()` 内部有 `refreshPromise` 去重保护。若此时有并发 warm-up 进行中，两者共享同一 Promise，不会产生双重请求或 `refreshPromise` 卡死。修复逻辑正确。✓

### [OK-5] 错误处理
`TokenWarmUpHandler` 的 `.catch()` 记录 warning 后静默吞下错误。这对 fire-and-forget 预热语义是合适的——warm-up 失败不应阻断流程，真正的翻译请求会在需要时重试。✓

### [OK-6] 类型安全
- `PageActivatedMessage` 在 `content/index.ts` 中使用 `import type` 导入，用于类型断言，不会被打包为运行时值。✓
- `MessageType` union 新增 `"PAGE_ACTIVATED"` 字符串字面量类型，`switch-case` 的 `default` 分支不会意外捕获此类型。✓
- `TokenWarmUpHandler` 使用命名空间导入（`import * as loggerModule`），符合项目约定。✓

### [OK-7] `PageActivatedMessage` 定义位置
类型定义紧跟 `MessageType` union 之后，结构清晰、易于查找。✓

---

## 💡 改进建议

### [S-1] `content/index.ts` — `PAGE_ACTIVATED` 可提前至 `init()` 第一行之前

目前 `PAGE_ACTIVATED` 在 `init()` 内部发送（async function）。可以考虑在模块顶层（非 async 上下文）立即发送，以进一步缩短唤醒 SW 的时间，不过收益极小（async function 本身几乎 0 延迟启动）。不强制修改。

### [S-2] `AuthService.ts` — logger 导入不符项目约定

`AuthService.ts` 使用：
```typescript
import { createLogger } from "@/0_common/utils/logger"
```
项目约定应使用命名空间导入：
```typescript
import * as loggerModule from "@/0_common/utils/logger"
const logger = loggerModule.createLogger("AuthService")
```
此为本次变更前的存量问题，建议在后续 cleanup 中顺手修正。

### [S-3] `TokenWarmUpHandler` — 响应状态码可进一步细化

`sendResponse({ status: "warming" })` 和 `sendResponse({ status: "not_initialized" })` 的区分很好，但 content script 对两者的返回值均不处理（`sendMessage` 的 Promise 根本没有被 `.then()` 消费）。可考虑将 `sendResponse` 的类型从 `(response: { status: string }) => void` 改为 `(response: unknown) => void` 以降低约束，或完全移除 response payload（content script 不消费它）。这是纯粹的减少无用代码建议，不影响功能。

### [S-4] 冷启动修复后 `not_initialized` 路径需重新评估

如果采纳 [C-1] 修复方案（在 `initializeServices()` 后主动 `getToken()`），则 `PAGE_ACTIVATED` 到达时 `isInitialized()` 大概率返回 true（取决于后续 `initializeServices()` 的完成时刻是否与之重合）。`not_initialized` 早返回路径仍是有效的防御性 guard，保留即可。

---

## 问题优先级汇总

| ID | 严重程度 | 描述 | 必须修复 |
|---|---|---|---|
| C-1 | 🔴 CRITICAL | 冷启动竞态：SW 初始化完成前 PAGE_ACTIVATED 始终被跳过，功能在最主要场景失效 | **是** |
| H-1 | 🟠 HIGH | 已打开 tab 在 SW 复活后无预热机制，首次翻译仍延迟 | 建议修复（可由 C-1 修复方案同时覆盖） |
| S-1~S-4 | 💡 SUGGESTION | 代码风格、细化建议 | 否 |

---

## 结论

**本次变更必须解决 [C-1] 后方可合并**。

核心修复一行：在 `background/index.ts` 的 `initialize()` 内，`await initializeServices()` 完成后立即触发 `getAuthService().getToken().catch(...)` 主动预热。该修复同时解决冷启动（C-1）和 SW 复活时已打开 tab（H-1）两个场景，且与现有 `refreshPromise` 去重机制天然兼容，无副作用。
