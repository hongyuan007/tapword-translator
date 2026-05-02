# 仓库路径映射

所有 subagent 都需要知道项目仓库的本地路径和 GitHub 远程地址。

## 仓库列表

| 名称 | 本地路径 | GitHub | 说明 |
|---|---|---|---|
| **tapword-translator** | `/home/coer/project/tapword-translator` | `hongyuan007/tapword-translator` | Chrome 扩展（前端） |
| **translate-api** | `/home/coer/project/translate-api` | `hongyuan007/translate-api` | 翻译 API（后端） |
| **plugin-web** | `/home/coer/project/plugin-web` | `hongyuan007/plugin-web` | 官网（Web） |

## 使用规则

- 每个 subagent prompt 必须列出相关的仓库路径
- 如果 issue 涉及前后端联动，subagent 需要同时访问前端和后端仓库
- 如果 issue 涉及官网展示，subagent 需要访问 plugin-web 仓库
- subagent 的 cwd 参数应设为主要修改的仓库路径

## 项目特定文件（tapword-translator）

| 文件 | 路径 | 用途 |
|---|---|---|
| 项目规则 | `AGENTS.md` | 代码风格、构建命令、模块约定 |
| 代码风格 | `docs/prompt_files/code_style/core.md` | TypeScript 编码规范 |
| Orchestrator 协议 | `docs/prompt_files/agent/subagent.prompt.md` | subagent 工作流模板 |
| Review 规则 | `docs/prompt_files/review/project-review-rule.prompt.md` | 代码审查标准 |
| Review Manifest | `docs/prompt_files/review/generate-review-manifest.prompt.md` | 审查清单格式 |

## 项目特定文件（translate-api）

| 文件 | 路径 | 用途 |
|---|---|---|
| 项目规则 | `AGENTS.md` | 代码风格、构建命令 |

## 项目特定文件（plugin-web）

| 文件 | 路径 | 用途 |
|---|---|---|
| 项目规则 | `agent.md` | 项目约定和构建命令 |
