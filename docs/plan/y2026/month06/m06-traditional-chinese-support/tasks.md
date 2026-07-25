# Tasks — 繁体中文支持

## 节点 1：需求澄清 ✅
- 产出物：requirement.md

## 节点 2：技术方案 ✅
- 产出物：proposal.md（方案 B 选定）

## 节点 3：TDD 测试先行 ✅
- 产出物：
  - `tests/1_content/utils/languageValidator.traditional-chinese.test.ts`（24 tests: 6 RED / 11 GREEN / 7 TODO）
  - `tests/0_common/utils/traditional-chinese-support.test.ts`（9 tests: 3 RED / 6 GREEN）
- 9 个 RED 全部有效（功能缺失导致，非语法错误）

## 节点 4：开发执行 ✅
- 产出物：7 个文件修改（见下方清单）
- 测试结果：54 passed | 7 todo（9 个原 RED 全部转 GREEN，回归零断裂）

### 修改文件清单

| # | 文件 | 改动类型 | 说明 |
|---|------|----------|------|
| 1 | `src/3_popup/index.html` | UI | 添加 `<option value="zh-Hant">繁體中文</option>` |
| 2 | `src/4_options/index.html` | UI | 同上 |
| 3 | `src/0_common/utils/languageDisplay.ts` | 显示层 | `LANGUAGE_NAME_MAP` 新增 `"zh-hant": "繁體中文"` |
| 4 | `src/0_common/utils/storageManager.ts` | 存储层 | `detectBrowserLanguage()` 精确匹配 zh-TW/zh-HK/zh-Hant → `"zh-Hant"` |
| 5 | `src/1_content/utils/languageValidator.ts` | 核心逻辑 | 新增 `isSameLanguage`、`isTraditionalChinese`、`detectChineseScript` 等函数；重写 zh-case 简繁区分；`getPageDeclaredLanguage` 保留完整 BCP 47 标签 |
| 6 | `src/1_content/utils/pageLanguageChecker.ts` | 核心逻辑 | 同步：`normalizeLangTag` 保留完整标签；`isPageLanguageSameAsTarget` 用 `isSameLanguage` 比较 |
| 7 | `tests/1_content/utils/languageValidator.unit.test.ts` | 测试适配 | 1 个回归测试适配：`xmlLang: "zh-TW"` → `"zh-CN"` |

## 节点 5：测试验证 ✅
- 产出物：`test-report.md`
- 本次改动相关测试：54 passed | 7 todo，零失败
- 预存失败 28 个均与本次改动无关（credentials 缺失、DOM Range 环境、模块不存在等）
- 构建失败为预存问题（credentials 模块缺失），不阻塞功能验收

## 节点 6：Code Review ✅（Round 02 完成）
- 产出物：`code-review-report.md` + `review/pr-local/round-02/`
- 双模型并行：GPT-5.5 + DeepSeek V4 Pro
- 结论：⚠️ CHANGES_REQUESTED（双 APPROVED 未达成）
- P0: 0 | P1: 3 | P2: 4 | P3: 4
- 核心阻塞项：detectChineseScript 同形文本误判 + 代码重复/逻辑分叉 + translationWalker.ts 范围外
- 安全性：✅ 无问题
