# 翻译目标语言支持繁体中文

## 背景

Issue #23 提出需求：当前 tapword-translator 支持的 8 种翻译目标语言（en, zh, es, ja, fr, de, ko, ru）中，中文仅有简体中文（`zh`），缺少繁体中文选项。对于习惯阅读繁体中文的用户（如台湾、香港、澳门及部分海外华人社群），无法将翻译结果输出为繁体中文是明显的体验缺失。

本需求旨在在翻译目标语言列表中新增繁体中文（`zh-Hant`），使用户可以选择将任意源语言文本翻译为繁体中文输出。

## 目标

用户可在 popup 和 options 页面的翻译目标语言下拉框中选择「繁體中文」，选择后翻译引擎正确输出繁体中文结果。

## 范围

### 包含

- **UI 层**：在 `src/3_popup/index.html` 和 `src/4_options/index.html` 的语言 `<option>` 列表中新增繁体中文选项
- **存储层**：在 `storageManager.ts` 的 `SUPPORTED_LANGUAGES` 数组中新增 `zh-Hant`
- **显示层**：在 `languageDisplay.ts` 的 `LANGUAGE_NAME_MAP` 中新增 `zh-Hant` → "繁體中文" 映射
- **引擎层**：确认各免费引擎 `LANGUAGE_CODE_MAP` 中 `zh-Hant` 映射正确可用（调研显示已预留）
- **翻译抑制**：确保 `suppressNativeLanguage` 逻辑能正确识别繁体中文页面，避免对已是繁体中文的页面执行翻译
- **i18n 层**：8 个 locale 文件中补充与繁体中文选项相关的 i18n key（如有需要）

### 不包含

- 不做源语言检测的繁简区分（源语言检测仍将 `zh-*` 统一归为 `zh`）
- 不新增繁体中文 locale 文件（`src/0_common/locales/` 不新增 `zh-Hant.json`）
- 不修改 Custom LLM 引擎的繁简区分逻辑（本次仅确保免费引擎链路通畅）
- 不改变现有简体中文（`zh`）的任何行为

## 用户场景

### 场景1：翻译为繁体中文

1. 用户在浏览器中选中一段英文文本
2. popup 弹出，用户在「翻译为」下拉框中选择「繁體中文」
3. 翻译引擎接收 `zh-Hant` 作为目标语言代码
4. 翻译结果以繁体中文显示在 popup 中
5. 设置自动保存，后续翻译默认输出繁体中文

### 场景2：繁体中文页面的翻译抑制

1. 用户浏览一个繁体中文网页（`<html lang="zh-TW">` 或 `zh-Hant`）
2. 用户已将翻译目标语言设为繁体中文（`zh-Hant`）
3. `suppressNativeLanguage` 逻辑检测到页面语言与目标语言一致，抑制翻译行为
4. 不对已是目标语言的页面执行冗余翻译

## 技术现状（基于调研）

### 引擎层

所有免费翻译引擎的 `LANGUAGE_CODE_MAP` **已预留 `zh-Hant` 映射**，无需新增代码：

| 引擎 | zh-Hant 映射目标 | 状态 |
|------|------------------|------|
| Microsoft Free | `zh-Hant`（直传） | ✅ 已就绪 |
| Google Free | `zh-TW` | ✅ 已就绪 |
| Bing Translate | `zh-Hant`（直传） | ✅ 已就绪 |
| MTranServer | `zh-Hant`（直传） | ✅ 已就绪 |
| Official Cloud API | 直接传 `targetLanguage` 字段 | ⚠️ 需确认后端是否支持 `zh-Hant` |
| Custom LLM | `zh-TW` 映射为 "Chinese" | ⚠️ 未区分繁简，本次不改动 |

### UI 层

语言列表硬编码在两处 HTML 文件的 `<option>` 标签中：

- `src/3_popup/index.html` — popup 语言选择下拉框
- `src/4_options/index.html` — options 页面语言设置

需在简体中文（`zh`）选项后追加繁体中文（`zh-Hant`）选项。

### 存储与显示层

- `storageManager.ts`：`SUPPORTED_LANGUAGES` 数组定义所有支持的语言代码，需新增 `zh-Hant`
- `languageDisplay.ts`：`LANGUAGE_NAME_MAP` 提供语言显示名，需新增 `zh-Hant` → `"繁體中文"`

### i18n 层

`src/0_common/locales/` 下有 8 个语言包文件（en, zh, es, ja, fr, de, ko, ru）。需检查是否有与目标语言名称相关的 i18n key，如有则补充繁体中文对应翻译。

### 浏览器语言检测

当前逻辑通过 `navigator.language` 获取浏览器语言，所有 `zh-*` 变体被 `split("-")[0]` 统一归为 `zh`。翻译抑制逻辑（`suppressNativeLanguage`）需确认是否能正确处理用户选择 `zh-Hant` 后对繁体中文页面的抑制。

## 验收标准

- [ ] 用户可在 popup 的翻译目标语言下拉框中选择「繁體中文」
- [ ] 用户可在 options 页面的翻译目标语言下拉框中选择「繁體中文」
- [ ] 选择繁体中文后，翻译结果输出为繁体中文文本
- [ ] Microsoft Free 引擎正确传递 `zh-Hant` 语言代码
- [ ] Google Free 引擎正确将 `zh-Hant` 映射为 `zh-TW`
- [ ] Bing Translate 引擎正确传递 `zh-Hant` 语言代码
- [ ] Official Cloud API 正确传递 `zh-Hant`（需后端确认支持，若不支持则在文档中标注风险）
- [ ] 简体中文（`zh`）及其他 7 种现有目标语言功能不受影响
- [ ] 繁体中文网页（`zh-TW`/`zh-Hant`）在目标语言为 `zh-Hant` 时翻译抑制逻辑正常工作
- [ ] `SUPPORTED_LANGUAGES` 数组包含 `zh-Hant`
- [ ] `LANGUAGE_NAME_MAP` 包含 `zh-Hant` → `"繁體中文"` 映射
- [ ] i18n locale 文件已检查并更新（8 个语言包补充相关 key）
- [ ] 所有现有测试通过
- [ ] Chrome 构建成功
- [ ] Firefox 构建成功

## 关联信息

- Issue: https://github.com/hongyuan007/tapword-translator/issues/23
- 分支: `feat/260613/traditional-chinese-support`
- 任务目录: `docs/plan/y2026/month06/m06-traditional-chinese-support/`
