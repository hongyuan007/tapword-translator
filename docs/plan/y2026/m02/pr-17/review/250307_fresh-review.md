# Code Review: PR-17 — Bing Translate & MTranServer Integration

**Date**: 2026-03-07  
**Reviewer**: GitHub Copilot (fresh, session-independent review)  
**Branch**: `Huchangzhi/main` → `main`  
**Scope**: `src/`, `package.json`

---

## Executive Summary

**Verdict: NEEDS_CHANGES**

本次 PR 为扩展新增了两个无需官方账号的翻译后端（Bing Translate 和 MTranServer 自托管），并对 Options 页做了翻译服务切换 UI（动画面板切换）。整体架构清晰，两个新服务模块代码质量较高。**但发现一个关键回归缺陷**：`manifest.json` 缺失 `https://*.tapword.cc/*` host_permission，将导致所有选用官方云服务的 Chrome 用户翻译请求被浏览器阻断。此外还有一个中等程度的 AbortController 共享问题以及若干 Minor Issues。

---

## Critical Issues（合并前必须修复）

### 1. `manifest.json` 缺少 `https://*.tapword.cc/*` host_permission — 官方云 API 对所有 Chrome 用户失效

**文件**: `src/manifest.json`

当前 Chrome MV3 manifest 的 `host_permissions` 仅有：

```json
"host_permissions": [
    "https://*.bing.com/*"
]
```

对比 `src/manifest-firefox.json`（MV2）的 `permissions`：

```json
"permissions": [
    "storage",
    "https://*.tapword.cc/*",
    "https://local.tapword.cc/*",
    "https://*.bing.com/*"
]
```

Firefox manifest 明确保留了 tapword.cc 域名，而 Chrome manifest 中 **`https://*.tapword.cc/*` 已缺失**。  
MV3 Service Worker 发起的 `fetch()` 请求受 `host_permissions` 约束——缺少该声明，对 `https://api.tapword.cc/...` 的请求将直接被 Chrome 以 "Missing host permission" 错误中断，导致**默认选用官方云服务的所有用户翻译全部失败**。

**修复方案**：

```json
"host_permissions": [
    "https://*.tapword.cc/*",
    "https://local.tapword.cc/*",
    "https://*.bing.com/*"
]
```

---

## Major Issues（强烈建议合并前修复）

### 2. `BingTranslateService.ts`：单个 AbortController 被子域名重试循环共享 — 超时后无法重试

**文件**: `src/6_translate/services/BingTranslateService.ts`，`fetchGlobalConfig()`

```typescript
// 当前代码
const controller = new AbortController()
const timeoutId = setTimeout(() => controller.abort(), BING_TRANSLATE_TIMEOUT)

for (const subdomain of subdomainsToTry) {
    try {
        const response = await fetch(`https://${subdomain}/translator`, {
            signal: controller.signal,  // ← 共享同一个 signal
        })
        ...
    } catch (error) {
        // AbortError 会被 catch，lastError 被更新，循环继续，
        // 但此时 signal 已经是 aborted 状态，下一次 fetch() 会立即 reject
    }
}
```

**问题**：10 秒超时触发后，`controller.abort()` 使 `signal` 进入 `aborted` 状态。此后每次循环中的 `fetch()` 调用会以 `AbortError` **立即**失败，而不是等待网络响应。表现为：第一个子域名超时后，后续所有子域名的重试均无效，用户收到不必要的"所有子域名均失败"错误。

**修复方案**：每次重试迭代创建新的 AbortController，或将整体超时 vs. 单次超时分离：

```typescript
for (const subdomain of subdomainsToTry) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), BING_TRANSLATE_TIMEOUT)
    try {
        const response = await fetch(`...`, { signal: controller.signal })
        clearTimeout(timeoutId)
        ...
    } catch (error) {
        clearTimeout(timeoutId)
        ...
    }
}
```

### 3. `animateContainerHeight`：`transitionend` 监听器可能永久泄漏

**文件**: `src/4_options/modules/settingsManager.ts`，`animateContainerHeight()`

```typescript
function animateContainerHeight(container: HTMLElement, targetHeight: number): void {
    container.style.height = `${targetHeight}px`
    const onEnd = (): void => {
        ...
        container.removeEventListener("transitionend", onEnd)
    }
    container.addEventListener("transitionend", onEnd)  // ← 每次调用均添加新监听器
}
```

**问题**：若 CSS transition 从未触发（`prefers-reduced-motion`、元素被隐藏、快速连续切换打断等情况），`onEnd` 回调永不执行，监听器无法自我移除。用户快速反复切换 Provider 时，每次都会向同一个 `container` 追加一个无法清除的 `transitionend` 监听器。

**修复方案**：使用 `{ once: true }` 注册监听器，并额外设置一个 fallback 定时器强制移除：

```typescript
function animateContainerHeight(container: HTMLElement, targetHeight: number): void {
    container.style.height = `${targetHeight}px`
    const onEnd = (): void => {
        if (container.style.height === `${targetHeight}px`) {
            if (targetHeight === 0) {
                container.style.height = ""
            }
        }
    }
    container.addEventListener("transitionend", onEnd, { once: true })
}
```

---

## Minor Issues / Suggestions

### 4. `TranslationService.ts`：新增导入违反项目命名空间导入规范

**文件**: `src/6_translate/services/TranslationService.ts`

```typescript
// 当前（命名导入，违反规范）
import { translateWithMTranServer, MTranServerError } from "./MTranServerService"
import { translateWithBingTranslate, BingTranslateError } from "./BingTranslateService"
```

项目约定（`AGENT.md` / `copilot-instructions.md`）要求使用命名空间导入：

```typescript
// 建议（命名空间导入）
import * as mtranServerServiceModule from "./MTranServerService"
import * as bingTranslateServiceModule from "./BingTranslateService"
```

### 5. `settingsManager.ts`：错误文案硬编码英文，未走 i18n

**文件**: `src/4_options/modules/settingsManager.ts`

以下字符串为硬编码英文，未使用 `i18nModule.translate(key)` 输出：

- `"Select 'Custom LLM API' as translation provider before validating."`
- `"MTranServer URL is required."`
- `"Connection successful! 'hello' translated successfully."`
- `"Connection failed."`

非英语 UI 用户会看到英文错误提示，与其他已 i18n 化的提示不一致。

### 6. `MTranServerService.ts`：缺少对 `data.result` 的存在性校验

**文件**: `src/6_translate/services/MTranServerService.ts`，`translateWithMTranServer()`

```typescript
const data = await response.json() as MTranTranslateResponse
logger.info("MTranServer translation successful:", data.result)
return data.result  // 若 server 返回的 JSON 结构意外，data.result 为 undefined
```

若 MTranServer 返回的 JSON 缺少 `result` 字段（例如版本不兼容、配置异常），`undefined` 会被无声地传入 `TranslationResult.wordTranslation`，内容脚本将渲染空白，用户收不到任何错误反馈。

**建议**：

```typescript
const data = await response.json() as MTranTranslateResponse
if (!data.result) {
    throw new MTranServerError("MTranServer returned invalid response: missing 'result' field")
}
return data.result
```

### 7. `Promise.all` 翻译降级策略：单项失败导致全部失败

**文件**: `src/6_translate/services/TranslationService.ts`

Bing / MTranServer 路径均使用：

```typescript
const [wordTranslation, sentenceTranslation] = await Promise.all([
    translateWith...(word, ...),
    hasContext ? translateWith...(fullSentence, ...) : Promise.resolve(undefined),
])
```

`Promise.all` 短路语义：若句子翻译请求失败，即使单词翻译已成功，整个表达式也会 reject，用户得不到任何结果。鉴于单词翻译是核心功能，建议将句子翻译失败降级为 `undefined`：

```typescript
const [wordTranslation, sentenceTranslation] = await Promise.all([
    translateWith...(word, targetLanguage, settings),
    hasContext
        ? translateWith...(fullSentence, targetLanguage, settings).catch(() => undefined)
        : Promise.resolve(undefined),
])
```

### 8. `manifest.json`：`version` 与 `version_name` 不一致

**文件**: `src/manifest.json`

```json
"version": "0.4.1",
"version_name": "0.4.2-bing",
```

`version` 控制 Chrome Web Store 更新逻辑，`version_name` 仅用于展示。两者不一致可能造成版本管理混乱。正式合并前应统一。

### 9. `BingTranslateService.ts`：HTML 抓取 regex 脆弱性（已知风险，应添加注释）

`fetchGlobalConfig()` 通过以下正则从 Bing 页面 HTML 提取配置：

- `/IG:"([^"]+)"/`
- `/data-iid="([^"]+)"/`
- `/params_AbusePreventionHelper\s?=\s?(\[[^\]]+\])/`

Bing 任何前端发布都可能使这些正则失效。目前代码对提取失败已有 `continue` 逻辑（会尝试下一子域名），但如果所有子域名都同样失败（Bing 结构全局变化），用户将收到无法解释的"所有子域名失败"错误。

**建议**：在函数顶部添加一条显式警告注释，说明该方案的脆弱性与维护风险：

```typescript
/**
 * WARNING: This function scrapes bing.com HTML to extract undocumented tokens.
 * It is fragile by nature — a Bing frontend deploy may break regex extraction
 * at any time without notice. Monitor for sudden widespread failures.
 */
```

### 10. `settings.bingTranslate.unofficialWarning` 为空字符串

**文件**: `src/0_common/locales/en.json`, `src/0_common/locales/zh.json`

```json
"settings.bingTranslate.unofficialWarning": "",
```

两个语言的该 key 均为空。若此 key 被渲染到 DOM，用户将看到空白。建议填入真实内容，或移除该 key 并从 HTML 中删除对应引用。

---

## Per-file Notes

| 文件 | 状态 | 关键备注 |
|---|---|---|
| `src/manifest.json` | ⛔ 关键缺陷 | 缺失 tapword.cc host_permission，官方云 API 对 Chrome 全量失效 |
| `src/manifest-firefox.json` | ✅ 正常 | 同时包含 tapword.cc 和 bing.com 权限，结构正确 |
| `src/6_translate/services/BingTranslateService.ts` | ⚠️ Major | AbortController 共享导致重试机制失效；HTML scraping 脆弱性；整体结构规范 |
| `src/6_translate/services/MTranServerService.ts` | ✅ 良好 | 结构清晰，超时/错误处理完整；缺 `data.result` 校验 |
| `src/6_translate/services/TranslationService.ts` | ⚠️ Minor | Provider 路由逻辑正确；命名导入违反项目规范；Promise.all 无降级 |
| `src/0_common/types/index.ts` | ✅ 正常 | `TranslationProvider` union 类型定义完整，默认值正确 |
| `src/0_common/utils/storageManager.ts` | ✅ 正常 | Community 版 provider 默认值逻辑正确；mtranserver normalization 正确 |
| `src/4_options/modules/settingsManager.ts` | ⚠️ Major | animateContainerHeight transitionend 泄漏；UI 逻辑结构清晰；错误文案硬编码英文 |
| `src/4_options/index.ts` | ✅ 正常 | 初始化顺序正确，setupBingTranslateTest/setupMTranServerTest 调用均正确 |
| `src/4_options/styles.css` | ✅ 正常 | provider-panel CSS 结构合理，绝对定位堆叠方案正确 |
| `src/0_common/locales/en.json` | ⚠️ Minor | unofficialWarning 为空字符串；其余新增 key 完整 |
| `src/0_common/locales/zh.json` | ⚠️ Minor | 同 en.json；翻译质量良好 |

---

## Conclusion

本次 PR 功能设计合理，两个新翻译后端实现质量整体较高。**必须在合并前修复 Critical Issue #1**（manifest.json 缺少 tapword.cc 权限），否则将对所有使用默认官方云服务的 Chrome 用户造成翻译全部失效的严重回归。 

Major Issues #2（AbortController）和 #3（transitionend 泄漏）虽然在常规使用路径下触发概率不高，但风险明确，强烈建议一并修复。

其余 Minor Issues 可安排后续跟进处理。
