# Fix #56: max_tokens → max_completion_tokens — 进度

## 状态：已完成（等待节点 5 验证）

## 子任务进度
| 任务 | 状态 | 备注 |
|------|------|------|
| T1: NEW_MODEL_PATTERN 常量 | ✅ | `/^(gpt-5\|o[134])/i`，含大小写归一化 |
| T2: OpenAICompatibleClient 条件参数 | ✅ | 展开运算符实现 |
| T3: 核心测试 8 个 | ✅ | 4 新模型 + 4 旧模型/第三方 |
| T4: 边界测试 4 个 | ✅ | 未知模型、GPT-5 大写、O1 大写、空模型名 |

## 变更文件
| 文件 | 变更类型 |
|------|----------|
| `src/8_generate/constants/GenerateConstants.ts` | 新增 `NEW_MODEL_PATTERN` 常量 |
| `src/8_generate/services/llm/OpenAICompatibleClient.ts` | `generate()` 条件参数 |
| `tests/8_generate/services/OpenAICompatibleClient.test.ts` | 新增 12 个测试用例 |

## 验证结果
- ✅ 12/12 测试通过
- ✅ 类型检查：本次修改文件无错误（ServiceInitializer.ts 预存问题无关）

## 变更记录
- 250626: T3 TDD 红阶段（4 红 4 绿）
- 250626: T1+T2 实现修复（8/8 绿）
- 250626: T4 补充边界测试 + 大小写 `i` flag（12/12 绿）
