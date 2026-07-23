# AI E2E 测试框架

TapWord Translator 的 AI 驱动端到端测试框架，使用 Playwright + GPT 视觉验证替代人工肉眼检查。

## 概述

传统 E2E 测试只能断言 DOM 元素存在，无法检测视觉渲染问题（CSS 错位、布局破坏等）。本框架通过「操作 → 截图 → AI 验证 → 报告」管道，让 AI 自动判定测试是否通过。

## 目录结构

```
tests/ai-e2e/
├── config/
│   └── playwright.config.ts   # 独立 Playwright 配置
├── fixtures/
│   ├── click-translate.html   # 单击翻译测试页
│   └── drag-select.html       # 划词翻译测试页
├── shared/
│   ├── browser.ts             # 浏览器启动/关闭辅助
│   ├── fixture-server.ts      # 本地 HTTP server
│   ├── screenshot.ts          # 截图工具
│   ├── ai-verifier.ts         # AI 验证模块
│   ├── reporter.ts            # 报告生成器
│   └── types.ts               # 共享类型
├── specs/
│   ├── click-translate.spec.ts # 单击翻译测试
│   └── drag-select.spec.ts     # 划词翻译测试
├── output/                     # 测试输出（已 gitignore）
└── README.md
```

## 运行命令

```bash
# 前提：先构建扩展
npm run build

# 运行所有 AI E2E 测试
npm run test:ai-e2e

# 仅运行 fixture 层测试（本地 HTML，无需网络）
npm run test:ai-e2e:fixture

# 仅运行 real 层测试（真实网站）
npm run test:ai-e2e:real
```

## 测试场景

| 场景 | Fixture 层 | Real 层 |
|------|-----------|---------|
| 单击翻译 | `click-translate.html` | wikipedia.org |
| 划词翻译 | `drag-select.html` | example.com |
| 全文翻译 | `fullpage-translate.html` | wikipedia.org |
| Popup 面板 | — | chrome-extension popup.html |
| 设置页 | — | chrome-extension options.html |

## 开发说明

- **AI 验证**：默认使用 stub 验证器（基于截图文件名 heuristic）。实际使用时通过 `setVerifyFn()` 注入真实 AI 调用。
- **浏览器**：默认使用 Edge（`msedge`），可通过 `PW_EXTENSION_CHANNEL` 环境变量切换。
- **Locale**：强制 `zh-CN`，确保扩展默认目标语言为中文。
- **超时**：每个测试 120 秒（扩展加载 + AI 验证需要较长时间）。
- **并行**：`workers: 1, fullyParallel: false`（扩展测试不可并行）。

### 添加新场景

1. 在 `fixtures/` 下创建测试 HTML 页面（如需要）
2. 在 `specs/` 下创建新的 `.spec.ts` 文件
3. 遵循 `shared/browser.ts` 中的初始化模式
4. 使用 `captureScreenshot()` 捕获操作前后截图
5. 截图路径输出到 console，供多模态 Agent（叶欣）视觉验收
