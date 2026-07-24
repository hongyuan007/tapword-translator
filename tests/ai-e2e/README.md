# AI 视觉产品验收系统

> **定位**：用 AI 替代人眼，做产品级别的质量验收。
> **实现方式**：Playwright 执行操作 + 截图 → 多模态 AI Agent 视觉判断 → PASS/FAIL 报告。

## 为什么要做这个

每次发版前，产品负责人需要手动打开浏览器、逐个功能操作、用肉眼判断"对不对"。耗时且容易遗漏。

本系统的目标：**一条命令，2 分钟内拿到全功能的视觉验收报告。**

## 核心架构

```
┌─────────────────────────────────────┐
│  执行层（Playwright）                 │
│  ─────────────────────────────────  │
│  • 启动浏览器、加载扩展              │
│  • 执行用户操作（点击、划词、滚动）    │
│  • 捕获截图（操作前 + 操作后）        │
│  • 功能性断言（关键元素存在）         │
│  • 输出：截图路径 + 操作日志          │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│  视觉验收层（叶欣 / GPT-5.6）         │
│  ─────────────────────────────────  │
│  • read(截图) → 视觉感知             │
│  • 对比操作前后变化                  │
│  • 判断：功能是否符合预期？           │
│  • 检测：布局、内容、样式是否正常      │
│  • 输出：PASS/FAIL + 理由            │
└─────────────────────────────────────┘
```

**原则：代码不做视觉判断，AI 不做操作执行。**

## 目录结构

```
tests/ai-e2e/              ← E2E 是实现方式，视觉验收是目的
├── config/
│   └── playwright.config.ts   # Playwright 配置
├── fixtures/                  # 本地测试页面
│   ├── click-translate.html
│   ├── drag-select.html
│   └── fullpage-translate.html
├── shared/                    # 共享工具
│   ├── browser.ts             # 浏览器启动/扩展加载
│   ├── fixture-server.ts      # 本地 HTTP server
│   ├── screenshot.ts          # 截图捕获
│   └── types.ts               # 类型定义
├── specs/                     # 验收场景（Playwright spec）
│   ├── click-translate.spec.ts
│   ├── drag-select.spec.ts
│   ├── fullpage-translate.spec.ts
│   ├── popup-panel.spec.ts
│   └── settings-page.spec.ts
├── output/                    # 截图输出（gitignore）
└── README.md
```

## 运行命令

```bash
# 前提：先构建扩展
npm run build

# 运行全部验收场景
npx playwright test --config tests/ai-e2e/config/playwright.config.ts

# 运行特定场景
npx playwright test --config tests/ai-e2e/config/playwright.config.ts tests/ai-e2e/specs/popup-panel.spec.ts
```

## 验收场景

| 场景 | Fixture 层 | Real 层 |
|------|-----------|---------|
| 单击翻译 | `click-translate.html` | wikipedia.org |
| 划词翻译 | `drag-select.html` | example.com |
| 全文翻译 | `fullpage-translate.html` | wikipedia.org |
| Popup 面板 | — | chrome-extension popup.html |
| 设置页 6 分区 | — | chrome-extension options.html |

## 视觉验收流程

1. Playwright 执行操作并截图到 `output/`
2. 触发叶欣验收（`sessions_spawn(agentId: "reviewer-ye-xin")`）
3. 叶欣用 `image` 工具读取截图，逐张判断 PASS/FAIL
4. 输出验收报告

## 开发说明

- **浏览器**：默认 Edge（`msedge`），可通过 `PW_EXTENSION_CHANNEL` 环境变量切换
- **Locale**：强制 `zh-CN`
- **超时**：每个测试 60-120 秒
- **并行**：`workers: 1, fullyParallel: false`（扩展测试不可并行）

### 添加新场景

1. 在 `fixtures/` 下创建测试 HTML 页面（如需要）
2. 在 `specs/` 下创建新的 `.spec.ts` 文件
3. 遵循 `shared/browser.ts` 中的初始化模式
4. 使用 `captureScreenshot()` 捕获操作前后截图
5. 加功能性断言（`expect`）确保关键元素存在
6. 截图路径输出到 console，供叶欣视觉验收
