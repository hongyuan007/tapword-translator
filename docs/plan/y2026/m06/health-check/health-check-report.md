# 健康检查报告

**检查时间**：2026-06-14 11:27 (Asia/Shanghai)
**项目**：tapword-translator
**分支**：feat/260613/traditional-chinese-support

## 1. Git 状态

- **工作区状态**：基本干净（仅有未跟踪的 `docs/plan/y2026/m06/` 目录，为本检查报告目录）
- **当前分支**：✅ `feat/260613/traditional-chinese-support`，确认正确
- **暂存区/工作区修改**：无已修改文件

## 2. 测试结果

- **状态**：❌ 有失败
- **统计**：通过 97 个，失败 28 个，跳过 16 个，todo 7 个（共 148 个）
- **测试文件**：11 失败 | 5 通过 | 1 跳过（共 17 个）

### 失败详情

#### 类别 A：模块缺失 / 导入解析失败（7 个测试文件，均为文件级失败）

| 测试文件 | 缺失模块 |
|----------|----------|
| `tests/1_content/utils/audioUtils.test.ts` | `@/1_content/utils/audioUtils` |
| `tests/1_content/utils/rangeSplitter.test.ts` | `@/1_content/utils/rangeSplitter` |
| `tests/1_content/utils/selectionValidator.unit.test.ts` | `@/1_content/utils/selectionValidator` |
| `tests/5_backend/services/AuthService.integration.test.ts` | `../../../src/5_backend/config/credentials` |
| `tests/5_backend/services/AuthService.simple.test.ts` | `../../../src/5_backend/config/credentials` |
| `tests/6_translate/services/TranslationService.integration.test.ts` | `../../../src/5_backend/config/credentials` |
| `tests/5_backend/services/ConfigService.simple.test.ts` | `other/key/dev/apikey.txt`（ENOENT） |

> **根因分析**：`config/credentials` 模块由构建脚本 `inject-secrets-simple.mjs` 动态生成，该脚本文件本身也缺失（见构建检查部分）。`audioUtils`、`rangeSplitter`、`selectionValidator` 三个模块可能尚未创建或已被移除/重命名。

#### 类别 B：contextExtractorV2 功能回归（21 个测试失败）

- **文件**：`tests/1_content/utils/contextExtractorV2.test.ts`
- **现象**：所有提取结果的 `text`、`leadingText`、`trailingText`、`currentSentence`、`previousSentences`、`nextSentences` 均为空字符串或空数组
- **可能根因**：`contextExtractorV2` 模块未能正确初始化或 DOM Range 交互逻辑存在缺陷，导致所有上下文提取返回空结果

#### 类别 C：rangeAdjuster 功能问题（5 个测试失败）

- **文件**：`tests/1_content/utils/rangeAdjuster.test.ts`
- **失败用例**：
  1. `should handle multiple types of whitespace characters`
  2. `should correctly trim leading whitespace when the range starts in a text node inside another element`
  3. `should handle a complex case with nested elements and mixed whitespace`
  4. `should expand backward across sibling elements when selection starts at the beginning of a text node`
  5. `should expand forward across sibling elements when selection ends at the end of a text node`

#### 类别 D：集成测试失败（2 个）

| 测试文件 | 失败用例 | 原因 |
|----------|----------|------|
| `tests/7_speech/services/SpeechService.integration.test.ts` | `should return a blob on successful synthesis` | Authentication not configured（缺少构建凭据） |
| `tests/6_translate/services/TranslationService.test.ts` | `should propagate API errors` | Mock 配置问题：`APIError` 未从 `@/5_backend` mock 中导出 |

## 3. 构建结果

- **状态**：❌ 失败
- **失败阶段**：`prebuild:dev`（`cross-env KEY_ENV=dev node other/scripts/inject-secrets-simple.mjs`）
- **错误详情**：

```
Error: Cannot find module '/Users/zhanghongyuan/project/tapword-translator/other/scripts/inject-secrets-simple.mjs'
```

> **根因**：构建前置脚本 `inject-secrets-simple.mjs` 文件缺失。该脚本负责注入开发环境密钥（生成 `src/5_backend/config/credentials`），其缺失同时导致了上述类别 A 中多个测试因找不到 `config/credentials` 模块而失败。

## 结论

项目当前处于**不健康状态**：构建链断裂（`inject-secrets-simple.mjs` 脚本缺失）导致构建失败，并连锁引发 7 个测试文件因凭据模块缺失而无法运行；此外 `contextExtractorV2` 和 `rangeAdjuster` 存在功能性回归（共 26 个测试失败），需要优先修复构建脚本和上下文提取逻辑。
