# 翻译目标语言支持繁体中文 — 技术方案

> **Issue**: [#23](https://github.com/hongyuan007/tapword-translator/issues/23)
> **分支**: `feat/260613/traditional-chinese-support`
> **需求文档**: `docs/plan/y2026/month06/m06-traditional-chinese-support/requirement.md`
> **日期**: 2026-06-13

---

## 现状分析

### 引擎层：大部分已就绪

对 4 个免费翻译引擎的 `LANGUAGE_CODE_MAP` 进行排查，发现 **zh-Hant 映射均已预留**：

| 引擎 | LANGUAGE_CODE_MAP 映射 | 状态 |
|------|------------------------|------|
| Microsoft Free | `zh-Hant` → `zh-Hant`（直传） | ✅ 就绪 |
| Google Free | `zh-Hant` → `zh-TW` | ✅ 就绪 |
| Bing Translate | `zh-Hant` → `zh-Hant`（直传） | ✅ 就绪 |
| MTranServer | `zh-Hant` → `zh-Hant`（直传） | ✅ 就绪 |
| Official Cloud API | **无映射、无白名单**，`targetLanguage` 原样透传到 `POST /api/v1/translate` | ⚠️ 不确定 |
| Custom LLM | `promptLoader.ts` L101 做 `split("-")[0]`，`zh-Hant` 会被截断为 `zh` | ⚠️ 需处理 |

**结论**：免费引擎层零改动即可支持繁体中文，无需新增任何引擎适配代码。

### UI 层：纯 HTML 硬编码

语言下拉列表为静态 HTML `<option>`，非 JS 动态渲染，分布在两处：

- `src/3_popup/index.html` L113-122 — `<select id="targetLanguage">` 下 8 个 `<option>`
- `src/4_options/index.html` L68-77 — 完全相同的硬编码列表

新增语言只需在这两处添加 `<option value="zh-Hant">繁體中文</option>`。

### 存储与显示层

- `storageManager.ts` L243 的 `SUPPORTED_LANGUAGES` 数组仅用于 `detectBrowserLanguage()` 函数——新用户首次安装时的浏览器语言匹配。不参与 UI 渲染或设置验证。
- `languageDisplay.ts` 的 `LANGUAGE_NAME_MAP` 提供语言代码到显示名的映射，需新增 `zh-Hant` 条目。

### 🔴 翻译抑制逻辑存在 Bug 风险（关键发现）

`shouldTriggerTranslationAsync()`（`languageValidator.ts` L63）入口处做 `targetLanguage.split("-")[0]` 归一化，将 `zh-Hant` 截断为 `zh`。代码中共有 **5 处** 类似的 `split("-")[0]` 归一化：

| # | 文件 | 行号 | 函数 |
|---|------|------|------|
| 1 | `languageValidator.ts` | ~L64 | `shouldTriggerTranslationAsync` 入口 |
| 2 | `languageValidator.ts` | ~L192 | `normalizeLanguageTag()` |
| 3 | `pageLanguageChecker.ts` | ~L85 | `isPageLanguageSameAsTarget()` 入口 |
| 4 | `pageLanguageChecker.ts` | ~L113 | `normalizeLangTag()` |
| 5 | `languageDetector.ts` | ~L129 | `normalizeLangCode()` |

**场景分析（targetLanguage = "zh-Hant" 时）**：

| 场景 | 页面语言 | split 后 | 匹配？ | 抑制？ | 行为 |
|------|----------|----------|--------|--------|------|
| 繁体页面 + 繁体目标 | `zh-TW` | `zh` == `zh` | ✅ 匹配 | ✅ 抑制 | ✅ **正确** |
| **简体页面 + 繁体目标** | `zh-CN` | `zh` == `zh` | ✅ 匹配 | ❌ 抑制 | ❌ **错误！用户想翻译为繁体但被阻止** |
| 英文页面 + 繁体目标 | `en` | `en` ≠ `zh` | ❌ 不匹配 | ✅ 不抑制 | ✅ **正确** |

**核心问题**：`split("-")[0]` 会丢失语言子标签信息，导致简体中文页面和繁体中文目标被视为「同一种语言」而被抑制。

### suppressNativeLanguage 触发路径

| 触发方式 | 是否受 suppressNativeLanguage 控制 | 默认行为 |
|----------|-----------------------------------|----------|
| doubleClick | ❌ 强制抑制（不看设置） | 总是抑制 |
| icon 触发 | ✅ 受控制 | 默认 false，不抑制 |
| singleClick | ✅ 受控制 | 默认 false，不抑制 |

### resolveTargetLanguage 回退逻辑

比较时使用原始字符串（不做 `split`）：源语言 `"zh"` ≠ 目标语言 `"zh-Hant"` → **不触发回退**。此行为是正确的，无需修改。

### detectBrowserLanguage 现状

新用户首次安装时，`zh-TW` 浏览器语言被 `split("-")[0]` 归为 `zh`，匹配到简体中文。理想情况下应匹配到繁体中文。

---

## 方案对比

### 方案 A：最小改动方案（仅 UI + 存储 + 显示）

**改动内容**：
- 在 `index.html`（popup 和 options）添加 `zh-Hant` option
- `SUPPORTED_LANGUAGES` 数组新增 `zh-Hant`
- `LANGUAGE_NAME_MAP` 新增 `zh-Hant: "繁體中文"`

**不改动**：翻译抑制逻辑保持原样（`split("-")[0]` 不变）。

**优点**：
- 改动量最小（3 个文件、约 5 行代码）
- 零回归风险——不触碰核心翻译路径
- 实现速度快

**缺点**：
- 🔴 **已知 Bug 不修复**：用户在简体中文页面上选择繁体中文目标时，翻译会被错误抑制（`zh-CN` 页面 → split → `zh` == `zh` → 抑制）
- 用户在知乎、微博等简体页面无法使用划词翻译为繁体，严重影响功能可用性
- `detectBrowserLanguage` 仍将 `zh-TW` 浏览器用户匹配到简体中文

### 方案 B：完整方案（UI + 抑制逻辑修复）

**改动内容**：
- 方案 A 的全部改动
- 修复 `shouldTriggerTranslationAsync` 和 `isPageLanguageSameAsTarget` 中的 `split("-")[0]` 逻辑
- 修改 `normalizeLanguageTag` / `normalizeLangTag` 保留完整的 BCP 47 语言标签
- 修复 `detectBrowserLanguage` 对 `zh-TW` / `zh-HK` 浏览器语言的精确匹配

**优点**：
- ✅ 行为完全正确：简体页面可翻译为繁体，繁体页面可翻译为简体
- ✅ 用户体验完整，无功能缺陷
- ✅ 修复了潜在的语言对比逻辑缺陷，提升代码质量
- 符合 BCP 47 标准的语言标签处理方式

**缺点**：
- 需修改核心路径代码（翻译抑制判断影响所有语言）
- 测试覆盖要求更高，需确保现有 8 种语言行为不变
- 改动涉及 4+ 文件、5 处归一化逻辑

### 方案 C：配置化方案（语言列表抽为数据源）

**改动内容**：
- 方案 B 的全部改动
- 将 HTML 硬编码的 `<option>` 改为由 JS 从配置文件动态渲染
- 抽离语言列表为独立数据源（如 `languages.ts`）

**优点**：
- 未来新增语言只需改一处配置
- 架构更清晰

**缺点**：
- 改动面远超 issue 范围
- 需要重构 popup 和 options 的初始化逻辑
- 引入动态渲染可能带来时序问题（DOM 渲染 vs 事件绑定）
- 风险高、收益与当前 issue 不匹配

### 对比汇总

| 方案 | 优点 | 缺点 | 改动范围 | 风险 |
|------|------|------|----------|------|
| A：最小改动 | 改动量最小、零回归风险 | 简体页面选繁体被错误抑制、功能不完整 | 3 文件、~5 行 | 🟢 低 |
| **B：完整方案** | **行为正确、体验完整、修复核心缺陷** | **需改核心路径、测试要求高** | **4-6 文件、~30 行** | **🟡 中** |
| C：配置化 | 可扩展性好 | 改动面大、超出 issue 范围、时序风险 | 8+ 文件、重构 | 🔴 高 |

---

## 选定方案：方案 B（完整方案）

**选定理由**：

1. **方案 A 有已知功能缺陷**：简体中文页面（zh-CN）选择繁体中文目标（zh-Hant）时，翻译会被错误抑制。这意味着用户在最常见的使用场景（简体页面 → 翻译为繁体）下功能完全不可用，这是不可接受的。
2. **方案 C 超出 issue 范围**：将语言列表配置化是一个架构重构，与「新增繁体中文支持」的需求无关，应作为独立的技术债 issue 处理。
3. **方案 B 的风险可控**：虽然有核心路径改动，但通过完善的测试计划（现有语言回归测试 + 新增 zh-Hant 场景测试）可以将风险降低到可接受水平。修复 `split("-")[0]` 的归一化缺陷本身也是提升代码质量的必要工作。

---

## 选定方案的改动范围

### 必须修改的文件

#### 1. UI 层（2 文件）

**`src/3_popup/index.html`** ~L113-122

在 `zh`（简体中文）option 之后添加繁体中文 option：

```html
<!-- 现有 -->
<option value="zh">简体中文</option>
<!-- 新增 -->
<option value="zh-Hant">繁體中文</option>
```

**`src/4_options/index.html`** ~L68-77

同上，在对应位置添加相同的 `<option value="zh-Hant">繁體中文</option>`。

#### 2. 存储层（1 文件）

**`src/0_common/utils/storageManager.ts`** ~L243

改动点 1：`SUPPORTED_LANGUAGES` 数组新增 `"zh-Hant"`：

```typescript
// 现有（示意）
const SUPPORTED_LANGUAGES = ["en", "zh", "ja", "ko", ...];
// 修改后
const SUPPORTED_LANGUAGES = ["en", "zh", "zh-Hant", "ja", "ko", ...];
```

改动点 2：`detectBrowserLanguage()` 函数（~L245-270）增加对 `zh-TW` / `zh-HK` 浏览器语言的精确匹配。在 `split("-")[0]` 回退逻辑之前，先检查完整语言标签：

```typescript
// 在 split 归一化之前，先尝试精确匹配
const browserLang = navigator.language;
if (browserLang === "zh-TW" || browserLang === "zh-HK" || browserLang === "zh-Hant") {
  return "zh-Hant";
}
// 原有 split("-")[0] 回退逻辑保持不变
```

#### 3. 显示层（1 文件）

**`src/0_common/utils/languageDisplay.ts`**

`LANGUAGE_NAME_MAP` 新增条目：

```typescript
"zh-Hant": "繁體中文",
```

#### 4. 翻译抑制逻辑（2 文件，4 处改动）

**`src/1_content/utils/languageValidator.ts`**

- **~L64 `shouldTriggerTranslationAsync` 入口**：移除 `targetLanguage.split("-")[0]` 归一化，保留完整的 BCP 47 标签传递给后续比较逻辑。修改比较策略，支持精确匹配和主语言子标签匹配两种模式。

- **~L192 `normalizeLanguageTag()`**：调整归一化策略。不再简单地 `split("-")[0]`，而是保留完整的语言标签。归一化仅处理大小写和分隔符统一（如将 `_` 替换为 `-`），不做子标签截断。

**`src/1_content/utils/pageLanguageChecker.ts`**

- **~L85 `isPageLanguageSameAsTarget()` 入口**：同步调整，不再做 `split("-")[0]`。改为智能比较：先比较完整标签，如果不匹配但主语言子标签相同且均为中文变体（`zh-*`），则进一步比较 script/region 子标签。

- **~L113 `normalizeLangTag()`**：与 `normalizeLanguageTag()` 保持一致的归一化策略。

**中文语言比较的特殊逻辑**（核心修复）：

```typescript
/**
 * 比较页面语言和目标语言是否相同（应抑制翻译）
 * 对于 zh-* 语言族，需要区分简繁；其他语言只比较主标签
 */
function isSameLanguage(pageLang: string, targetLang: string): boolean {
  const normalizedPage = normalizeLanguageTag(pageLang);
  const normalizedTarget = normalizeLanguageTag(targetLang);
  
  // 完全匹配
  if (normalizedPage === normalizedTarget) return true;
  
  // 中文族特殊处理：zh-CN/zh-Hans 简体，zh-TW/zh-HK/zh-Hant 繁体
  const pageMain = getMainSubtag(normalizedPage);  // "zh"
  const targetMain = getMainSubtag(normalizedTarget);  // "zh"
  
  if (pageMain === "zh" && targetMain === "zh") {
    // 都是中文，需要区分简繁
    const pageIsTraditional = isTraditionalChinese(normalizedPage);
    const targetIsTraditional = isTraditionalChinese(normalizedTarget);
    return pageIsTraditional === targetIsTraditional;
  }
  
  // 非中文族：只比较主标签（保持原有行为）
  return pageMain === targetMain && pageMain !== "zh";
}

function isTraditionalChinese(lang: string): boolean {
  const lower = lang.toLowerCase();
  return lower.includes("hant") || lower.includes("tw") || lower.includes("hk") || lower.includes("mo");
}
```

> **注意**：`languageDetector.ts` ~L129 的 `normalizeLangCode()` 暂不修改。该函数用于页面语言检测的归一化，其输出会被上述 `isSameLanguage` 正确处理。

### 可能需要修改的文件

#### 5. i18n 层（最多 8 文件）

**`src/0_common/locales/*.json`**

检查是否有语言名称相关的 i18n key（如 `lang_zh` 之类）。如果有用户可见的语言名称需要本地化，则需添加 `lang_zh_hant` 对应的翻译。预计改动量极小或为零（语言名称本身就是各语言的固有名词）。

#### 6. Custom LLM 层（1 文件）

**`src/6_translate/services/promptLoader.ts`** ~L101

现有逻辑：`targetLanguage.split("-")[0]` → `zh-Hant` 会变成 `zh`，LLM 收到的提示是「翻译成中文」而非「翻译成繁体中文」。

修改方案：在 split 之前增加 `zh-Hant` 的特殊判断：

```typescript
// 修改前
const langCode = targetLanguage.split("-")[0];

// 修改后
const langCode = targetLanguage === "zh-Hant" ? "zh-Hant" : targetLanguage.split("-")[0];
```

或更通用的方案，维护一个不应被截断的语言标签白名单：

```typescript
const FULL_TAG_LANGUAGES = new Set(["zh-Hant"]);
const langCode = FULL_TAG_LANGUAGES.has(targetLanguage) ? targetLanguage : targetLanguage.split("-")[0];
```

---

## 风险评估

### 🔴 高风险

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| **翻译抑制逻辑改动影响所有语言** | `shouldTriggerTranslationAsync` 和 `isPageLanguageSameAsTarget` 是核心路径，改动可能影响现有 8 种语言的抑制判断 | 1. 改动策略：非中文族保持 `getMainSubtag` 比较（等效于原 `split("-")[0]`），仅对 `zh-*` 语言族启用简繁区分逻辑；2. 编写单元测试覆盖全部 8 种现有语言的抑制场景；3. 新增 zh-Hant 专项测试用例 |
| **split("-")[0] 是全局性模式** | 代码中有 5 处类似归一化，改动时可能遗漏边界条件或漏改某处 | 1. 本方案明确列出所有需改动的文件和行号；2. 全局搜索 `split("-")` 确认无遗漏；3. 对 5 处归一化逐一分析，仅修改必要的 4 处（第 5 处 `languageDetector.ts` 经分析无需修改） |

### 🟡 中风险

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| **Official Cloud API 不支持 zh-Hant** | 后端翻译服务可能不支持繁体中文，用户选择后翻译请求会报错 | 1. 前端不做拦截（因为不确定后端能力），先上线让用户可用；2. 后续与后端确认是否支持；3. 如确认不支持，再考虑前端引擎层增加 fallback 或灰显处理 |
| **detectBrowserLanguage 改动** | 影响 zh-TW/zh-HK 浏览器新用户的默认语言选择 | 1. 仅在 `split` 回退之前增加精确匹配判断，不改变原有回退逻辑；2. 测试 zh-CN、zh-TW、zh-HK、en-US 等常见浏览器语言的匹配结果 |

### 🟢 低风险

| 风险 | 影响 | 应对策略 |
|------|------|----------|
| **UI option 添加** | 纯 HTML 添加，不影响逻辑 | 无需特殊应对 |
| **LANGUAGE_NAME_MAP 添加** | 纯数据映射新增 | 无需特殊应对 |

---

## 验证计划

### 单元测试

1. **`isSameLanguage` 函数测试**（新增）：
   - `zh-CN` vs `zh-Hant` → `false`（简体页面不应抑制繁体翻译）
   - `zh-TW` vs `zh-Hant` → `true`（繁体页面应抑制繁体翻译）
   - `zh-Hans` vs `zh-Hant` → `false`
   - `zh` vs `zh-Hant` → `false`（无 region 的 zh 视为简体）
   - `en` vs `zh-Hant` → `false`
   - `en` vs `en` → `true`（回归验证）
   - `ja` vs `en` → `false`（回归验证）
   - `ko` vs `ja` → `false`（回归验证）

2. **`normalizeLanguageTag` / `normalizeLangTag` 测试**（调整）：
   - 输入 `zh-Hant` 输出 `zh-Hant`（不再截断）
   - 输入 `ZH-hant` 输出 `zh-Hant`（大小写归一化）
   - 输入 `en` 输出 `en`（回归验证）

3. **`detectBrowserLanguage` 测试**（新增）：
   - `navigator.language = "zh-TW"` → 返回 `"zh-Hant"`
   - `navigator.language = "zh-HK"` → 返回 `"zh-Hant"`
   - `navigator.language = "zh-CN"` → 返回 `"zh"`（回归验证）
   - `navigator.language = "en-US"` → 返回 `"en"`（回归验证）

### E2E / 手动验证

1. **简体页面 → 繁体目标**：打开知乎（zh-CN 页面），划词翻译，确认翻译功能正常触发（不被抑制），翻译结果为繁体中文。
2. **繁体页面 → 繁体目标**：打开苹果台湾官网（zh-TW 页面），划词翻译，确认翻译功能被正确抑制。
3. **英文页面 → 繁体目标**：打开 BBC 英文站，划词翻译，确认翻译功能正常触发，翻译结果为繁体中文。
4. **繁体页面 → 简体目标**：打开繁体页面，目标设为简体中文，确认翻译功能正常触发（不被抑制）。
5. **现有语言回归**：目标设为英文/日文/韩文等，在中文页面上划词翻译，确认行为与改动前一致。
6. **UI 验证**：popup 和 options 页面的语言下拉列表中可见「繁體中文」选项，选中后正确保存。
7. **各引擎验证**：分别使用 Microsoft Free、Google Free、Bing Translate、MTranServer 引擎，目标设为繁体中文，确认翻译正常。

---

## 关联信息

- **Issue**: https://github.com/hongyuan007/tapword-translator/issues/23
- **需求文档**: `docs/plan/y2026/month06/m06-traditional-chinese-support/requirement.md`
- **分支**: `feat/260613/traditional-chinese-support`
- **BCP 47 参考**: https://www.rfc-editor.org/rfc/rfc5646.txt（语言标签规范）
