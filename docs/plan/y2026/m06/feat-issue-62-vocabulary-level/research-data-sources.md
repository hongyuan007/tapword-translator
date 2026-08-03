# 数据来源调研：词汇等级开源词库

> 调研时间：2026-06-14
> 调研目标：为 tapword-translator 词汇等级功能寻找合适的开源/公开词库数据源

## 核心结论

**推荐以 ECDICT（MIT License）作为主数据源**，其 `tag` 字段已覆盖中考/高考/四级/六级/考研/托福/雅思/GRE 等全部国内考试体系等级标注，且包含 BNC/COCA 词频排名和牛津 3000 标记。辅以 CEFR-J 数据集（CC-BY-SA）补全国际通用框架 CEFR 等级。两者组合可实现目标全部等级体系的覆盖。

---

## 数据源逐一分析

### 1. ECDICT（skywind3000/ECDICT）⭐ 主推荐

- **来源 URL**: https://github.com/skywind3000/ECDICT
- **数据格式**: CSV（基础版 ~77 万词条）、SQLite、MySQL（提供转换工具 `stardict.py`）
- **词条数量**: 约 77 万词条（基础 CSV `ecdict.csv`），完整版 `stardict.7z` 收词更多
- **许可证**: **MIT License**（2025 Linwei / skywind3000）—— 商用友好，无限制
- **数据质量**: ★★★★★ 最高
  - `tag` 字段包含考试等级标注：`zk`(中考)、`gk`(高考)、`cet4`(四级)、`cet6`(六级)、`ky`(考研)、`toefl`(托福)、`ielts`(雅思)、`gre`(GRE) 等，空格分割
  - `collins` 字段：柯林斯星级（1-5 星）
  - `oxford` 字段：是否牛津 3000 核心词汇
  - `bnc` 字段：BNC（英国国家语料库）词频排名
  - `frq` 字段：COCA（美国当代语料库）词频排名
  - `phonetic`：音标
  - `definition`：英文释义
  - `translation`：中文释义
  - `pos`：词性频率分布（如 `n:46/v:54`）
  - `exchange`：动词时态/名词复数等变形信息
- **维护状态**: 活跃，最近 2025 年仍有更新；社区贡献者众多
- **获取方式**: `git clone https://github.com/skywind3000/ECDICT.git`，CSV 直接在仓库根目录
- **优势**:
  - 一站式覆盖几乎所有需要的等级体系（国内考试 + 词频 + 牛津核心词）
  - MIT 许可证，法务零风险
  - 数据量大且经过 BNC/COCA 校对
  - 提供完整的 Python 工具链（CSV ↔ SQLite ↔ MySQL 互转）
  - 词条变形信息（exchange 字段）是独家特色
- **劣势**:
  - 无 CEFR 等级标注
  - 无专四/专八（TEM-4/TEM-8）的明确标签（但核心词汇已包含）
  - CSV 基础版约 77 万条，体积较大；完整版需下载 7z 压缩包

### 2. CEFR-J Vocabulary Profile（openlanguageprofiles/olp-en-cefrj）

- **来源 URL**: https://github.com/openlanguageprofiles/olp-en-cefrj
- **原始数据**: http://www.cefr-j.org/download.html
- **数据格式**: CSV
- **词条数量**: A1-B2 约 8,000+ 词条；C1/C2（Octanove 补充版）约 3,000+ 词条
- **许可证**:
  - CEFR-J Vocabulary Profile: 可用于研究和商业用途，**需引用出处**（版权属 Tono Laboratory, TUFS）
  - Octanove Vocabulary Profile C1/C2: **CC-BY-SA 4.0**
- **数据质量**: ★★★★☆
  - 每个词条标注 CEFR-J 等级（A1/A2/B1/B2/C1/C2）
  - 包含词性（POS）
  - 包含核心用法类别（core usage categories）
  - 纯英文单词列表，无中文释义
- **维护状态**: ver 1.5（2020 年发布），稳定但更新不频繁
- **获取方式**: 直接从 GitHub 仓库下载 CSV
- **优势**:
  - CEFR 是国际通用语言能力框架，对国际用户有意义
  - 学术项目，数据质量可靠
  - 商业可用（需引用）
- **劣势**:
  - 仅覆盖 CEFR 等级，无国内考试标注
  - 词条数较少（约 1 万+），不包含所有英语单词
  - 需要与其他数据源交叉合并

### 3. Words-CEFR-Dataset（Maximax67/Words-CEFR-Dataset）

- **来源 URL**: https://github.com/Maximax67/Words-CEFR-Dataset
- **数据格式**: SQLite (`word_cefr_minified.db`, ~20MB)、CSV（words.csv, word_pos.csv 等）
- **词条数量**: 大量英语单词（基于 Google 1-grams 数据集），覆盖面远超 CEFR-J 原版
- **许可证**: **MIT License**
- **数据质量**: ★★★★☆
  - 每个单词的每个词性（POS）都有 CEFR 等级（A1-C2）
  - 包含词频数据（Google Ngram）
  - 包含词干（stem）和词元（lemma）信息
  - 等级通过算法计算（结合 CEFR-J + 词频 + 词干推断），非纯人工标注
  - 已集成到 `cefrpy` Python 库
- **维护状态**: 活跃，已集成到 cefrpy 模块
- **获取方式**: `git clone https://github.com/Maximax67/Words-CEFR-Dataset.git`
- **优势**:
  - MIT 许可证，完全开放
  - 覆盖面广（算法推断 CEFR 等级，而非仅限人工标注的词汇）
  - 含词性和词频信息
- **劣势**:
  - CEFR 等级由算法推断，非权威人工标注，存在误差
  - 无中文释义
  - 数据模型较复杂（多表关联）

### 4. kajweb/dict

- **来源 URL**: https://github.com/kajweb/dict
- **数据格式**: JSON（每个词库一个 zip 包，内含 JSON 文件）
- **词条数量**: 覆盖 CET4(2607-3739)、CET6(2078-2345)、考研(1341-4533)、专四(595-4025)、专八(684-12197)、IELTS(3427-3575)、TOEFL(4264-9213)、GRE(3036-7199)、SAT(4423)、GMAT(3254) 等
- **许可证**: **⚠️ 无明确许可证** —— 数据来源标注为「爬取自有道背单词 App」，存在版权风险
- **数据质量**: ★★★★☆
  - 每个词条包含：单词、中文释义、英文释义、词性、美/英音标、例句（2-3 句）、短语、同近义词、同根词、历年真题选择题
  - 数据非常丰富，适合背单词场景
  - 提供有道发音 API URL
- **维护状态**: 不活跃（最后一次提交约 2019-2020 年）
- **获取方式**: 从 GitHub 仓库下载各词库 zip 包
- **优势**:
  - 覆盖全部国内 + 国际考试等级
  - 数据维度丰富（例句、短语、真题等）
  - JSON 格式易于解析
  - qwerty-learner 项目即使用此数据源
- **劣势**:
  - **无明确开源许可证**，数据爬取自有道，法务风险高
  - 数据来源为商业产品（有道词典），不适合商用
  - 不再维护，数据可能过时
  - 词条释义中有少量法语字符混入

### 5. KyleBing/english-vocabulary

- **来源 URL**: https://github.com/KyleBing/english-vocabulary
- **数据格式**: TXT（单词\t释义）、JSON（含词条、释义、短语）
- **词条数量**: 初中(3223)、高中(6008)、四级(7508)、六级(5651)、考研(9602)、托福(13477)、SAT(8887)
- **许可证**: **⚠️ 无明确许可证**（数据源自 kajweb/dict 的 fork 简化版）
- **数据质量**: ★★★☆☆
  - TXT 版：单词 + 中文释义，格式简单
  - JSON 版：单词 + 多条释义 + 短语（含翻译）
  - 乱序和正序两个版本
- **维护状态**: 33 次提交，有一定维护
- **获取方式**: `git clone https://github.com/KyleBing/english-vocabulary.git`
- **优势**:
  - 分类清晰，各类考试词汇分文件存放
  - TXT 格式极其简单
  - 词条数合理（经过整理）
- **劣势**:
  - 无明确许可证
  - 数据来源链：kajweb/dict → KyleBing/dict → 本库，原始数据版权问题仍在
  - 无音标、无例句（TXT 版）
  - 无 CEFR 标注

### 6. mahavivo/english-wordlists

- **来源 URL**: https://github.com/mahavivo/english-wordlists
- **数据格式**: TXT（纯文本，每行一个单词或单词+释义）
- **词条数量**: CET4、CET6(合编)、COCA 20000、GRE 8000、TOEFL、台湾高中 7000 词、OALD8 等
- **许可证**: **⚠️ 无明确许可证**（数据来源于官方大纲 PDF、金山词霸 2003 等）
- **数据质量**: ★★☆☆☆
  - 纯单词列表（部分含中文释义）
  - 无音标、无词性标注、无例句
  - 来源为大纲 PDF 手动提取，有一定校对
- **维护状态**: 92 次提交，但主要为历史整理，不活跃
- **获取方式**: `git clone https://github.com/mahavivo/english-wordlists.git`
- **优势**:
  - COCA 20000 词频表有中文翻译
  - 含 GRE 去重词表（删除四六级/托福后）
  - 台湾高中 7000 词有参考价值
- **劣势**:
  - 无许可证
  - 数据质量偏低（纯文本，信息少）
  - 部分数据来源为金山词霸 2003 版

### 7. Oxford 3000/5000（多个 GitHub 仓库）

- **来源 URL**:
  - https://github.com/sapbmw/The-Oxford-3000 (TXT/PDF/DOC)
  - https://github.com/tyypgzl/Oxford-5000-words (JSON)
  - https://github.com/samuraitruong/oxford-3000 (JSON)
- **数据格式**: TXT、JSON
- **词条数量**: Oxford 3000（~3000 词）、Oxford 5000（~5000 词，含 3000 + 2000）
- **许可证**: **⚠️ 无明确许可证** —— Oxford 3000/5000 是牛津大学出版社的知识产权
- **数据质量**: ★★★☆☆
  - 纯单词列表（含 CEFR 等级标注的部分版本有）
  - 牛津官方版本含 CEFR 等级和词性
- **维护状态**: 各仓库均为静态存档，不活跃
- **获取方式**: 直接从上述 GitHub 仓库下载
- **优势**:
  - 牛津 3000 是权威的核心词汇清单
  - 可作为词汇重要性的参考标准
- **劣势**:
  - **版权属于牛津大学出版社**，商用需授权
  - 数据量小
  - 各 GitHub 仓库均无合法授权

### 8. COCA 词频列表

- **来源 URL**:
  - https://www.english-corpora.org/coca/ （官方）
  - https://github.com/mahavivo/english-wordlists （COCA_20000.txt，含中文翻译）
  - https://www.wordfrequency.info/ （部分免费，部分付费）
- **数据格式**: TXT、CSV
- **词条数量**: 免费 5000 词；付费版 60000 词
- **许可证**: **⚠️ Brigham Young University 提供，免费部分仅限学术使用，商业使用需购买授权**
- **数据质量**: ★★★★★（词频数据）
  - 基于 10 亿词的美国当代英语语料库
  - 词频排名极为准确
  - 含词性分布
- **维护状态**: 持续更新（最新到 2019 年数据）
- **获取方式**: 官网注册下载部分免费数据
- **优势**:
  - 最权威的美国英语词频数据
  - ECDICT 的 `frq` 字段已内嵌 COCA 词频排名，无需单独获取
- **劣势**:
  - 完整数据商业使用需付费
  - 仅词频排名，不含等级标注
  - **建议通过 ECDICT 间接使用**（ECDICT 已将其作为字段嵌入）

### 9. qwerty-learner 内置词库

- **来源 URL**: https://github.com/RealKai42/qwerty-learner （词库在 `public/dicts/` 目录）
- **数据格式**: JSON（前端直接消费的格式）
- **词条数量**: CET-4、CET-6、GMAT、GRE、IELTS、SAT、TOEFL、考研、专四、专八、高考、中考、商务英语、BEC 等
- **许可证**: 项目整体为 **MIT License**，但**词库数据来自 kajweb/dict**（爬取自有道），词库数据的版权独立于项目许可证
- **数据质量**: ★★★☆☆
  - JSON 格式，前端友好
  - 含单词、释义、音标、例句
  - 数据质量取决于 kajweb/dict
- **维护状态**: 项目活跃（GitHub Stars 15K+），词库更新不频繁
- **获取方式**: 可参考其词库 JSON 格式和分类方式
- **优势**:
  - JSON 格式经过前端验证，可直接参考
  - 覆盖面广
  - 活跃的开源社区
- **劣势**:
  - 词库数据版权有瑕疵（源自有道爬取）
  - 不适合直接复制词库数据到商业项目

---

## 对比总结表

| 数据源 | 格式 | 词条数 | 许可证 | 数据质量 | 维护 | 覆盖等级 |
|--------|------|--------|--------|----------|------|----------|
| **ECDICT** | CSV/SQLite | ~77万 | **MIT** ✅ | ★★★★★ | 活跃 | 中考/高考/CET4/CET6/考研/托福/雅思/GRE + BNC/COCA词频 + 牛津3000 + 柯林斯星级 |
| **CEFR-J (olp-en-cefrj)** | CSV | ~1.1万 | 研究商用（需引用）+ CC-BY-SA(C1/C2) | ★★★★☆ | 稳定 | CEFR A1-C2 |
| **Words-CEFR-Dataset** | SQLite/CSV | 大量 | **MIT** ✅ | ★★★★☆ | 活跃 | CEFR A1-C2（算法推断） |
| kajweb/dict | JSON | ~6万(各词库总和) | ⚠️ 无许可 | ★★★★☆ | 不活跃 | CET4/6/考研/专四/八/IELTS/TOEFL/GRE/SAT/GMAT |
| KyleBing/english-vocabulary | TXT/JSON | ~5.4万 | ⚠️ 无许可 | ★★★☆☆ | 一般 | 初中/高中/CET4/6/考研/托福/SAT |
| mahavivo/english-wordlists | TXT | ~5万 | ⚠️ 无许可 | ★★☆☆☆ | 不活跃 | CET4/6/GRE/TOEFL/COCA/台湾高中 |
| Oxford 3000/5000 | TXT/JSON | ~5000 | ⚠️ 牛津版权 | ★★★☆☆ | 静态 | 牛津核心词 + 部分CEFR |
| COCA 词频 | TXT/CSV | 2万-6万 | ⚠️ 商用需付费 | ★★★★★ | 持续 | 仅词频排名 |
| qwerty-learner 词库 | JSON | ~6万 | MIT(代码) / ⚠️ 词库版权瑕疵 | ★★★☆☆ | 活跃 | 全部国内+国际考试 |

---

## 推荐方案

### 方案：ECDICT 为主 + CEFR-J/cefrpy 为辅

#### 第一层：核心数据源 = ECDICT（MIT License）

**理由：**
1. **许可证安全**：MIT License，商用零风险
2. **一站式覆盖**：`tag` 字段已包含 `zk/gk/cet4/cet6/ky/toefl/ielts/gre` 全部国内考试等级标注
3. **词频数据内嵌**：`bnc` 和 `frq` 字段直接提供 BNC 和 COCA 词频排名
4. **附加质量指标**：`collins`（柯林斯星级）和 `oxford`（牛津 3000）字段
5. **数据量大**：77 万词条覆盖几乎所有英语单词
6. **变形信息**：`exchange` 字段提供动词时态/名词复数等，可在翻译时做 lemma 还原

**使用方式：**
- 从 `ecdict.csv` 中提取 `word` 和 `tag` 字段
- 构建 `word → levels[]` 映射表（如 `"abandon" → ["cet4", "cet6", "ky"]`）
- 利用 `bnc`/`frq` 字段补充词频排名
- 利用 `collins`/`oxford` 字段补充重要度指标

#### 第二层：CEFR 等级补充 = Maximax67/Words-CEFR-Dataset（MIT License）

**理由：**
1. 同为 MIT License，法务安全
2. 覆盖大量单词的 CEFR 等级（A1-C2）
3. 含词性级别的 CEFR 标注

**使用方式：**
- 提取 `word → CEFR level` 映射
- 与 ECDICT 数据合并，补充国际通用框架等级

#### 第三层（可选）：CEFR-J 官方数据 = olp-en-cefrj

**理由：**
1. 人工标注的权威 CEFR 数据
2. 需引用出处（成本可控）

**使用方式：**
- 对核心高频词使用 CEFR-J 官方标注，提高准确度
- 对 CEFR-J 未覆盖的词，使用 Words-CEFR-Dataset 的算法推断值

#### 不推荐使用的数据源

| 数据源 | 不推荐原因 |
|--------|-----------|
| kajweb/dict | 无许可证，数据爬取自有道 App，商用有版权风险 |
| KyleBing/english-vocabulary | 上游链版权瑕疵传递 |
| mahavivo/english-wordlists | 无许可证，数据质量偏低 |
| Oxford 3000/5000 GitHub 仓库 | 牛津大学出版社版权，各仓库均无合法授权 |
| COCA 官方完整数据 | 商用需付费，且 ECDICT 已内嵌其词频排名 |

#### 整合实施建议

1. **构建词汇等级数据库**:
   ```
   word → {
     levels: ["cet4", "gk", ...],        // 来自 ECDICT tag
     cefr: "B1",                          // 来自 cefrpy / CEFR-J
     bnc_rank: 1234,                      // 来自 ECDICT bnc
     coca_rank: 5678,                      // 来自 ECDICT frq
     collins_stars: 3,                     // 来自 ECDICT collins
     oxford_3000: true,                    // 来自 ECDICT oxford
   }
   ```

2. **数据预处理流程**:
   - 下载 ECDICT CSV → 解析 tag 字段 → 构建 word→levels 映射
   - 下载 Words-CEFR-Dataset SQLite → 提取 word→CEFR level
   - 合并两份数据 → 输出为项目内部 JSON 或 SQLite

3. **Chrome 扩展集成方式**:
   - 将合并后的词汇等级数据打包为扩展内置资源（JSON 格式）
   - 翻译时查询单词 → 显示等级标签（如 `CET-4` `高考` `B1` `COCA #3421`）
   - 数据量控制：仅提取核心词（约 3-5 万条），非全部 77 万词条

4. **预估数据量**:
   - 有等级标注的词条：CET4 ~4000 + CET6 ~2500 + 考研 ~5500 + 高考 ~3500 + 托福 ~4000 + 雅思 ~3500 + GRE ~3000 ≈ 去重后约 2.5-3 万词
   - 加上 CEFR 覆盖的词：约 4-5 万词
   - JSON 格式预估大小：约 1-2 MB（可接受）

---

## 附录：ECDICT tag 字段值参考

| tag 值 | 含义 |
|--------|------|
| `zk` | 中考词汇 |
| `gk` | 高考词汇 |
| `cet4` | 大学英语四级 |
| `cet6` | 大学英语六级 |
| `ky` | 考研词汇 |
| `toefl` | 托福词汇 |
| `ielts` | 雅思词汇 |
| `gre` | GRE 词汇 |
| (空) | 非考试大纲词汇 |

注意：ECDICT 的 tag 字段不包含 TEM-4/TEM-8（专四/专八）标签。如需专四专八数据，需要从其他来源补充，或参考 kajweb/dict 的 Level4/Level8 词库（但注意版权问题）。
