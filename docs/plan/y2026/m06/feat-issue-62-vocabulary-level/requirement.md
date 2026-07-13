# 查词显示词汇等级（Issue #62）— 需求文档

## 背景

### 用户痛点
用户「不懂我能学」反馈（2026-06-13 飞书反馈）：在划词翻译时，希望知道当前查的单词属于哪个词汇阶段（如高考、考研、四六级、雅思、托福等），以帮助判断单词的重要性和难度。

当前 tapword-translator 的翻译结果展示单词翻译、音标、词典释义，但**不包含任何词汇难度/等级信息**。用户无法直观判断「这个词值不值得重点记忆」或「这个词在我的考试范围内吗」。

### Issue 来源
- GitHub Issue：[#62](https://github.com/TapWord/tapword-translator/issues/62)
- 反馈渠道：飞书用户反馈截图
- 类型：功能增强（enhancement）

### 为什么做
国内主流词典产品（有道词典、欧路词典、金山词霸）已普遍在查词结果中展示词汇等级标注，这是中国英语学习者的核心需求。tapword-translator 作为翻译+学习工具，补充词汇等级信息可以提升学习价值，增强用户粘性。

---

## 行业调研

> 完整报告：[research-industry.md](./research-industry.md)

### 核心发现

**国内词典产品普遍展示考试等级标签，国际权威词典使用语料库词频分级体系。两类信息互补。**

### 同类产品对比

| 产品 | 等级体系 | UI 形态 | 数据来源 | 用户评价 |
|------|---------|---------|---------|---------|
| **有道词典** | 高考/四级/六级/考研/专四/专八/雅思/托福/GRE/SAT | 彩色 badge，释义页头部音标附近 | 自有考试词库 | 备考用户高度依赖 |
| **欧路词典** | 国内考试 + Collins 星级 + CEFR | 文字标签，随词典模板变化 | 自有词库 + 第三方 MDX | 自带标注不准，用户依赖第三方词典 |
| **金山词霸** | Collins 五星 + 国内考试 | Collins 红色圆点 | Collins 授权 + 自有词库 | Collins 标注有价值 |
| **朗文 LDOCE** | Longman 9000 红点 + S/W 口语书面语分级 | 红色圆点 + S/W 字母 | 自有语料库 | 教师推崇，口语/书面语分离是独创 |
| **牛津 OALD** | Oxford 3000/5000 + CEFR（A1-C1） | 钥匙符号 + CEFR 字母 | 牛津语料库 | 国际标准，简洁权威 |
| **柯林斯 Collins** | 五星词频（14,700 词分 5 级） | 红色圆点（1-5 颗） | Collins 语料库 | 覆盖 95% 日常英语 |

### 行业标杆做法（有道词典）
- 在查词结果页**单词头部区域、音标下方**，以彩色标签形式展示
- 不同标签使用不同颜色区分
- 标签可点击查看详情
- 备考用户高度依赖此功能

### 对 tapword-translator 的启发
1. **国内考试等级是核心需求**：中国用户划词翻译时最关心「这个词属于哪个考试范围」
2. **彩色 badge 是主流 UI 形态**：放在单词旁、音标附近，轻量不干扰
3. **双轨制标注更佳**：考试等级（用户最关心）+ 词频/CEFR（国际通用补充）
4. **标注准确性是生命线**：欧路词典自带标注被用户评价「不准」，损害信任
5. **ECDICT 开源词库**被社区验证为可靠的等级数据来源

---

## 数据来源分析

> 完整报告：[research-data-sources.md](./research-data-sources.md)

### 核心结论

**推荐 ECDICT（MIT License）作为主数据源**，辅以 Words-CEFR-Dataset（MIT License）补全 CEFR 等级。法务零风险，数据质量最高。

### 推荐数据源

| 数据源 | 许可证 | 格式 | 词条数 | 覆盖等级 | 推荐度 |
|--------|--------|------|--------|---------|--------|
| **ECDICT** (skywind3000) | **MIT** ✅ | CSV/SQLite | ~77万 | 中考/高考/CET4/CET6/考研/托福/雅思/GRE + BNC/COCA词频 + 牛津3000 + 柯林斯星级 | ⭐⭐⭐⭐⭐ |
| **Words-CEFR-Dataset** (Maximax67) | **MIT** ✅ | SQLite/CSV | 大量 | CEFR A1-C2（算法推断） | ⭐⭐⭐⭐ |
| **CEFR-J** (olp-en-cefrj) | CC-BY-SA / 需引用 | CSV | ~1.1万 | CEFR A1-C2（人工标注） | ⭐⭐⭐ |

### 不推荐的数据源（许可证风险）

| 数据源 | 不推荐原因 |
|--------|-----------|
| kajweb/dict | 无许可证，数据爬取自有道 App |
| KyleBing/english-vocabulary | 上游链版权瑕疵传递 |
| mahavivo/english-wordlists | 无许可证，数据质量偏低 |
| Oxford 3000/5000 GitHub 仓库 | 牛津大学出版社版权 |
| COCA 官方完整数据 | 商用需付费（ECDICT 已内嵌其词频排名） |

### ECDICT 关键字段

| 字段 | 说明 | 示例 |
|------|------|------|
| `word` | 单词 | abandon |
| `tag` | 考试等级标签（空格分割） | `cet4 cet6 ky` |
| `collins` | 柯林斯星级（1-5） | 3 |
| `oxford` | 牛津 3000 标记 | 1 |
| `bnc` | BNC 词频排名 | 1234 |
| `frq` | COCA 词频排名 | 5678 |
| `phonetic` | 音标 | əˈbændən |

### tag 字段值对照

| tag 值 | 含义 | 词汇量 |
|--------|------|--------|
| `zk` | 中考 | ~1,600 |
| `gk` | 高考 | ~3,500 |
| `cet4` | 四级 | ~4,500 |
| `cet6` | 六级 | ~2,500（增量） |
| `ky` | 考研 | ~5,500 |
| `toefl` | 托福 | ~4,000 |
| `ielts` | 雅思 | ~3,500 |
| `gre` | GRE | ~3,000 |

> ⚠️ ECDICT 不包含专四/专八（TEM-4/TEM-8）标签。如需覆盖需额外数据源。

### 预估数据量
- 有等级标注的词条（去重后）：约 **2.5-3 万词**
- 加上 CEFR 覆盖：约 **4-5 万词**
- 提取后的 JSON 文件大小：约 **1-2 MB**（可直接打包到扩展中）

---

## 现有功能分析

> 完整报告：[research-codebase.md](./research-codebase.md)

### 查词流程概览

```
用户选中文本
  → InputListener.handleTextSelection()         [1_content/handlers/InputListener.ts]
  → iconManager.show()                           [1_content/ui/iconManager.ts]
  ── 用户点击图标 ──
  → TranslationPipeline.processTranslation()     [1_content/handlers/TranslationPipeline.ts]
      ├── 语言检测 + 选中类型分类（word/fragment）
      └── translateWordPath()
            ├── contextExtractorV2 提取上下文
            ├── translationDisplay.showTranslationResult()  ← 先渲染 loading
            ├── translationRequest.requestTranslation()     ← 发送到 background
            │   └── TranslationService.translateWord()      ← 调用云端 API
            └── translationDisplay.updateTranslationResult() ← 更新为成功结果
                                                                    ↓
                          点击展开 → translationModal（详情弹窗）
```

### 翻译结果数据流

```
后端 API 响应 (TranslationApiResponse)
  → TranslationResult (6_translate)
  → TranslateResponseSuccessMessage.data (0_common/types)
  → SuccessState (1_content/ui/translationDisplayV2/types)
  → TranslationDetailData (1_content/ui/translationModal)
  → modalTemplates.renderSuccessTemplate() → HTML 渲染
```

### UI 展示层级

| 层级 | 组件 | 展示内容 | 适合展示词汇等级？ |
|------|------|---------|-------------------|
| **Tooltip** | 浮动卡片 | 仅翻译文本（有 200 字符截断） | ❌ 空间有限 |
| **Modal** | 详情弹窗 | 单词、翻译、音标、词典释义、操作按钮 | ✅ 等级信息属于详细信息 |

### 词汇等级嵌入方案（两个候选）

| 方案 | 思路 | 优势 | 劣势 |
|------|------|------|------|
| **A. API 响应层** | 后端返回 `vocabularyLevel` 字段，沿数据链路透传 | 与现有字段（lemma/phonetic）同层级，模式一致 | 需后端改动；仅 cloud provider 可用；非官方 provider 无此字段 |
| **C. 前端本地词库** | 扩展内置词汇等级数据（ECDICT 提取），前端本地查找 | 零网络延迟；全 provider 覆盖；离线可用 | 增加包体积 1-2MB；需维护本地词库 |

> ⚠️ 方案选择涉及技术选型，留待节点 2（技术方案）决策。两个方案均需在 modal 模板中新增 badge UI。

---

## 目标

### 核心目标
在 tapword-translator 的**单词翻译详情弹窗（Modal）**中，展示查词单词所属的词汇等级标签，帮助用户快速了解单词的重要性和难度。

### 具体目标
1. 覆盖国内主要考试等级：高考、CET-4、CET-6、考研、雅思、托福、GRE
2. 一个单词可能属于多个等级，取**最高等级**（最难的考试）作为主标签展示
3. UI 以轻量彩色 badge 形式展示，不干扰主要翻译阅读体验
4. 数据来源合法合规，许可证清晰（MIT License）

### 不做（Out of Scope）
- ❌ 不在 Tooltip（浮动卡片）中展示等级（空间有限）
- ❌ 不覆盖短语/句子的等级标注（仅单个英文单词）
- ❌ 不覆盖中英双向（仅英→中查词时展示）
- ❌ 不覆盖专四/专八（TEM-4/TEM-8）（ECDICT 无此数据，后续可扩展）
- ❌ 不做等级标注的用户自定义/编辑功能

---

## 范围

### 功能边界

| 维度 | 范围 |
|------|------|
| **语言** | 仅英语单词（源语言为英文，目标语言为中文） |
| **触发条件** | 用户查词（selection type = "word"）时展示；短语/句子翻译不展示 |
| **等级体系** | **主标签（国内考试）**：高考、CET-4、CET-6、考研、雅思、托福、GRE<br>**辅助信息（可选）**：Collins 星级、COCA 词频排名 |
| **展示位置** | Modal 详情弹窗，单词右侧/下方 |
| **展示形态** | 彩色 badge/标签，不同等级使用不同颜色 |
| **多等级处理** | 一个单词属于多个等级时，展示最高等级（或前 2 个等级） |
| **无等级单词** | 不在 ECDICT 等级覆盖范围内的单词，不展示 badge（静默处理） |

### 等级颜色方案（建议）

| 等级 | 颜色建议 | 含义 |
|------|---------|------|
| 高考 | 浅蓝 | 基础 |
| CET-4 | 蓝色 | 基础+ |
| CET-6 | 深蓝 | 中级 |
| 考研 | 紫色 | 中级+ |
| 雅思 | 橙色 | 中高级 |
| 托福 | 深橙 | 高级 |
| GRE | 红色 | 最高级 |

> 注：颜色方案为建议，最终设计在技术方案阶段确定。

---

## 验收标准

### 功能验收

- [ ] **AC-1**：查询单个英文单词（如 "abandon"），Modal 详情弹窗中在单词附近展示词汇等级 badge（如 "CET-4" "CET-6" "考研"）
- [ ] **AC-2**：查询不属于任何考试等级的单词（如 "serendipity"），Modal 中不展示 badge，布局不受影响
- [ ] **AC-3**：查询属于多个等级的单词（如 "abandon" 同时属于 CET-4/CET-6/考研），展示最高等级或多个等级标签
- [ ] **AC-4**：短语/句子翻译时不展示词汇等级 badge
- [ ] **AC-5**：Tooltip（浮动卡片）中不展示词汇等级 badge

### 数据验收

- [ ] **AC-6**：词汇等级数据来源为 ECDICT（MIT License），无许可证风险
- [ ] **AC-7**：提取后的词库覆盖至少 2 万个英文单词的等级标注
- [ ] **AC-8**：词库数据文件大小不超过 3MB

### UI 验收

- [ ] **AC-9**：badge 样式轻量，不干扰翻译内容的主视觉
- [ ] **AC-10**：badge 在 Modal 暗色/亮色主题下均可正常显示
- [ ] **AC-11**：不同等级使用不同颜色区分

### 技术验收

- [ ] **AC-12**：TypeScript 类型安全，无 `any` 类型
- [ ] **AC-13**：所有新增代码通过现有的 TypeScript 类型检查（`npm run type-check`）
- [ ] **AC-14**：所有现有测试通过（无回归）
- [ ] **AC-15**：扩展包大小增幅不超过 3MB

---

## 关联信息

| 项目 | 内容 |
|------|------|
| GitHub Issue | [#62 — 查词时显示单词所属阶段](https://github.com/TapWord/tapword-translator/issues/62) |
| 开发分支 | `feat/2026-06-14/vocabulary-level` |
| 任务目录 | `docs/plan/y2026/m06/feat-issue-62-vocabulary-level/` |
| 行业调研报告 | [research-industry.md](./research-industry.md) |
| 数据来源调研报告 | [research-data-sources.md](./research-data-sources.md) |
| 现有功能调研报告 | [research-codebase.md](./research-codebase.md) |
| 主数据源 | ECDICT: https://github.com/skywind3000/ECDICT (MIT License) |
| CEFR 补充源 | Words-CEFR-Dataset: https://github.com/Maximax67/Words-CEFR-Dataset (MIT License) |

---

## 待决策（留待节点 2 技术方案）

以下问题在需求澄清阶段识别，但决策留待技术方案阶段：

1. **数据查询方式**：前端本地词库（方案 C）还是后端 API 返回（方案 A）还是混合方案？
2. **多等级展示策略**：展示所有等级标签，还是只展示最高等级，还是展示前 N 个？
3. **CEFR 是否首期实现**：首期只做国内考试等级，还是同时上 CEFR？
4. **Collins 星级 / COCA 词频是否展示**：作为辅助信息展示，还是首期不展示？
5. **词库更新机制**：随版本发布静态打包，还是支持动态更新？
