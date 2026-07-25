/**
 * 绑定契约测试 (Binding Contract Test)
 *
 * 本测试用于验证 src/4_options/index.html 重构前后绑定契约一致性。
 * 枚举来源：requirement.md 第 3 章「绑定契约（完整清单）」
 *
 * 测试范围：
 * 1. data-setting 控件（21 个）— 断言存在性 + input type 匹配
 * 2. 关键 ID（~63 个，JS 直接 getElementById 引用）— 断言存在性
 * 3. 类钩子（~40 个静态 HTML 中应有的 class）— 断言静态 HTML 中存在
 * 4. 独立绑定控件（5 个，不走 data-setting 泛化机制）— 断言存在性 + ID 正确
 *
 * 差异说明（requirement.md vs 实际 HTML）：
 * - aiProviderInlineForm：requirement 3.2 引擎相关 ID 列出，但实际由 JS 动态创建（翻译引擎内联编辑表单），
 *   不在静态 HTML 中，已排除。
 * - icon-preview--variant / ghost-button / ghost-button-danger / highlight-language /
 *   is-disabled / feature-dot-off：均为 JS 运行时动态添加/移除的 class，不在静态 HTML 中，已排除。
 * - providerPanelsContainer / preview-fab-light / preview-fab-dark：JS 引用但 HTML 中不存在
 *   （requirement 已标注为安全跳过 null），不在本测试范围。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Parse the HTML file once ──────────────────────────────────────────────
const htmlPath = resolve(__dirname, '../index.html');
const htmlContent = readFileSync(htmlPath, 'utf-8');
const dom = new JSDOM(htmlContent);
const document = dom.window.document;

// ── Helper functions ──────────────────────────────────────────────────────
function getById(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function querySelectorAll(selector: string): Element[] {
  return Array.from(document.querySelectorAll(selector));
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. data-setting 控件（21 个）
// ═══════════════════════════════════════════════════════════════════════════

describe('绑定契约测试', () => {
  describe('data-setting 控件', () => {
    type SettingType = 'checkbox' | 'select' | 'radio' | 'range' | 'custom-select';

    const dataSettings: Array<{ name: string; type: SettingType; radioCount?: number; description: string }> = [
      { name: 'enableTapWord', type: 'checkbox', description: '主开关' },
      { name: 'targetLanguage', type: 'select', description: '目标语言' },
      { name: 'showIcon', type: 'checkbox', description: '划词翻译图标' },
      { name: 'singleClickTranslate', type: 'checkbox', description: '单击翻译' },
      { name: 'doubleClickTranslateV2', type: 'checkbox', description: '双击翻译' },
      { name: 'doubleClickSentenceTranslate', type: 'checkbox', description: '双击翻译句子' },
      { name: 'doubleClickSentenceTriggerKey', type: 'select', description: '触发键（JS 填充 option）' },
      { name: 'suppressNativeLanguage', type: 'checkbox', description: '母语网页禁用' },
      { name: 'iconColor', type: 'radio', radioCount: 8, description: '划词图标颜色（8 个 radio）' },
      { name: 'wordUnderlineColorV2', type: 'custom-select', description: '单词下划线颜色' },
      { name: 'sentenceUnderlineColor', type: 'custom-select', description: '句子下划线颜色' },
      { name: 'fullTranslateLightColor', type: 'custom-select', description: '全文译文颜色（亮色）' },
      { name: 'fullTranslateDarkColor', type: 'custom-select', description: '全文译文颜色（暗色）' },
      { name: 'translationFontSizePresetV2', type: 'select', description: '译文字号' },
      { name: 'autoAdjustHeight', type: 'checkbox', description: '自动调行高' },
      { name: 'restoreLineHeightOnClear', type: 'checkbox', description: '清除时还原行高' },
      { name: 'tooltipBottomSpacingPxV3', type: 'range', description: 'Tooltip 底部间距' },
      { name: 'tooltipTextOffsetPxV3', type: 'range', description: '译文垂直位置' },
      { name: 'tooltipUnderlineOffsetPxV3', type: 'range', description: '下划线偏移量' },
      { name: 'autoPlayAudio', type: 'checkbox', description: '自动播放语音' },
      { name: 'networkRegion', type: 'radio', radioCount: 3, description: '网络地区（3 个 radio）' },
    ];

    expect(dataSettings.length).toBe(21);

    dataSettings.forEach(({ name, type, radioCount, description }) => {
      it(`data-setting="${name}" — ${description} (${type})`, () => {
        if (type === 'checkbox') {
          const els = querySelectorAll(`input[type="checkbox"][data-setting="${name}"]`);
          expect(els.length, `Expected 1 checkbox with data-setting="${name}"`).toBe(1);
        } else if (type === 'select') {
          const els = querySelectorAll(`select[data-setting="${name}"]`);
          expect(els.length, `Expected 1 select with data-setting="${name}"`).toBe(1);
        } else if (type === 'range') {
          const els = querySelectorAll(`input[type="range"][data-setting="${name}"]`);
          expect(els.length, `Expected 1 range input with data-setting="${name}"`).toBe(1);
        } else if (type === 'radio') {
          const els = querySelectorAll(`input[type="radio"][data-setting="${name}"]`);
          expect(els.length, `Expected ${radioCount} radio inputs with data-setting="${name}"`).toBe(radioCount);
        } else if (type === 'custom-select') {
          const els = querySelectorAll(`.custom-select-wrapper[data-setting="${name}"]`);
          expect(els.length, `Expected 1 .custom-select-wrapper with data-setting="${name}"`).toBe(1);
        }
      });
    });

    it('floatingButtonColorSelect 不应有 data-setting（独立绑定）', () => {
      const el = getById('floatingButtonColorSelect');
      expect(el).not.toBeNull();
      expect(el!.getAttribute('data-setting')).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2. 关键 ID（JS 直接 getElementById 引用）
  // ═════════════════════════════════════════════════════════════════════════

  describe('关键 ID', () => {
    describe('引擎相关 ID（14 个，aiProviderInlineForm 为 JS 动态创建已排除）', () => {
      const engineIds = [
        'wordTranslationProviderSelect',
        'fullPageTranslationProviderSelect',
        'addAiProviderBtn',
        'aiProviderList',
        'aiProviderForm',
        'aiProviderFormId',
        'aiProviderName',
        'aiProviderEndpoint',
        'aiProviderApiKey',
        'aiProviderModel',
        'aiProviderFormTest',
        'aiProviderFormTestResult',
        'aiProviderFormCancel',
        'aiProviderFormSave',
      ];

      engineIds.forEach((id) => {
        it(`getElementById("${id}") exists`, () => {
          const el = getById(id);
          expect(el, `Element with id="${id}" not found in HTML`).not.toBeNull();
        });
      });
    });

    describe('外观预览 ID（6 个）', () => {
      const previewIds = [
        'ap-word-tooltip-light',
        'ap-word-tooltip-dark',
        'ap-sent-tooltip-light',
        'ap-sent-tooltip-dark',
        'ap-full-trans-light',
        'ap-full-trans-dark',
      ];

      previewIds.forEach((id) => {
        it(`getElementById("${id}") exists`, () => {
          const el = getById(id);
          expect(el, `Element with id="${id}" not found in HTML`).not.toBeNull();
        });
      });
    });

    describe('Tooltip 预览 ID（7 个）', () => {
      const tooltipIds = [
        'tooltipPreview',
        'tooltipPreviewStage',
        'tooltipPreviewParagraph',
        'tooltipPreviewAnchor1',
        'tooltipPreviewAnchor', // 注意：无尾数 1
        'tooltipPreviewTooltip1',
        'tooltipPreviewTooltip',
      ];

      tooltipIds.forEach((id) => {
        it(`getElementById("${id}") exists`, () => {
          const el = getById(id);
          expect(el, `Element with id="${id}" not found in HTML`).not.toBeNull();
        });
      });
    });

    describe('外观选择器 ID（17 个）', () => {
      const selectorIds = [
        'icon-variant-picker',
        'floatingButtonEnabledOptions',
        'floatingButtonColorSelect',
        'floatingButtonColorPreview',
        'floatingButtonColorLabel',
        'wordUnderlineColorSelect',
        'wordUnderlineColorPreview',
        'wordUnderlineColorLabel',
        'sentenceUnderlineColorSelect',
        'sentenceUnderlineColorPreview',
        'sentenceUnderlineColorLabel',
        'fullTranslateLightColorSelect',
        'fullTranslateLightColorPreview',
        'fullTranslateLightColorLabel',
        'fullTranslateDarkColorSelect',
        'fullTranslateDarkColorPreview',
        'fullTranslateDarkColorLabel',
      ];

      selectorIds.forEach((id) => {
        it(`getElementById("${id}") exists`, () => {
          const el = getById(id);
          expect(el, `Element with id="${id}" not found in HTML`).not.toBeNull();
        });
      });
    });

    describe('Range 数值显示 ID（3 个）', () => {
      const rangeIds = [
        'tooltipBottomSpacingPxV3Value',
        'tooltipTextOffsetPxV3Value',
        'tooltipUnderlineOffsetPxV3Value',
      ];

      rangeIds.forEach((id) => {
        it(`getElementById("${id}") exists`, () => {
          const el = getById(id);
          expect(el, `Element with id="${id}" not found in HTML`).not.toBeNull();
        });
      });
    });

    describe('其他关键 ID（10 个）', () => {
      const otherIds = [
        'communitySubtitle',
        'autoPlayAudioCommunityNote',
        'autoPlayAudioSettingItem',
        'suppressNativeLanguageLabel',
        'settingItem-doubleClickSentence',
        'connectionCard',
        'connectionCardTitle',
        'documentationButton',
        'githubButton',
        'versionDisplay',
      ];

      otherIds.forEach((id) => {
        it(`getElementById("${id}") exists`, () => {
          const el = getById(id);
          expect(el, `Element with id="${id}" not found in HTML`).not.toBeNull();
        });
      });
    });

    describe('Section 锚点 ID（6 个）', () => {
      const sectionIds = [
        'general-settings',
        'appearance-settings',
        'translation-engine-settings',
        'display-settings',
        'audio-settings',
        'advanced-settings',
      ];

      sectionIds.forEach((id) => {
        it(`getElementById("${id}") exists`, () => {
          const el = getById(id);
          expect(el, `Element with id="${id}" not found in HTML`).not.toBeNull();
        });
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3. 类钩子（静态 HTML 中应存在的 class）
  // ═════════════════════════════════════════════════════════════════════════

  describe('类钩子', () => {
    // 排除的 JS 动态 class（不在静态 HTML 中）：
    // - is-disabled（JS classList.toggle 动态添加/移除）
    // - feature-dot-off（JS classList.toggle）
    // - icon-preview--variant（JS 创建浮动球变体时动态生成）
    // - ghost-button / ghost-button-danger（JS 创建 AI 提供商行按钮时生成）
    // - highlight-language（JS 设置 suppressNativeLanguageLabel innerHTML 时生成）

    const staticClasses: Array<{ className: string; description: string }> = [
      { className: 'setting-item', description: '设置行容器' },
      { className: 'toggle-switch', description: '开关控件' },
      { className: 'toggle-slider', description: '开关滑块' },
      { className: 'toggle-switch-master', description: '主开关特殊尺寸' },
      { className: 'toggle-switch-pink', description: '粉色开关' },
      { className: 'select-input', description: 'select 下拉框' },
      { className: 'range-input', description: 'range 滑块' },
      { className: 'range-setting-value', description: 'range 数值显示' },
      { className: 'range-setting-header', description: 'range 数值容器' },
      { className: 'custom-select-wrapper', description: '自定义下拉容器' },
      { className: 'custom-select-trigger', description: '自定义下拉触发器' },
      { className: 'custom-option', description: '下拉选项' },
      { className: 'color-dot', description: '色点' },
      { className: 'color-name', description: '色名文本' },
      { className: 'custom-select-arrow', description: '下拉箭头' },
      { className: 'icon-option', description: '图标选项容器' },
      { className: 'icon-preview', description: '图标预览' },
      { className: 'icon-picker-container', description: '图标选择器网格容器' },
      { className: 'radio-card', description: '单选卡片' },
      { className: 'radio-group', description: '单选卡片容器' },
      { className: 'radio-info', description: '卡片内信息' },
      { className: 'radio-title', description: '卡片标题' },
      { className: 'radio-desc', description: '卡片描述' },
      { className: 'appearance-preview', description: '外观预览容器' },
      { className: 'ap-panel', description: '亮/暗面板' },
      { className: 'ap-panel--light', description: '亮面板' },
      { className: 'ap-panel--dark', description: '暗面板' },
      { className: 'tooltip-preview', description: 'Tooltip 预览容器' },
      { className: 'tooltip-preview-tooltip-content', description: 'Tooltip 预览内容（JS 操作 marginTop/paddingBottom）' },
      { className: 'tooltip-preview-anchor--word', description: '预览单词锚点' },
      { className: 'tooltip-preview-anchor--phrase', description: '预览短语锚点' },
      { className: 'nav-item', description: '导航项' },
      { className: 'settings-section', description: 'section 容器' },
      { className: 'text-input', description: '文本输入框' },
      { className: 'primary-button', description: '主按钮' },
      { className: 'secondary-button', description: '次要按钮' },
      { className: 'feature-dot', description: 'singleClick 红点标记' },
      { className: 'community-note', description: '社区版提示' },
      { className: 'trigger-key-select', description: '触发键 select 紧凑样式' },
      { className: 'plus-separator', description: '触发键 + 文字之间的加号' },
    ];

    staticClasses.forEach(({ className, description }) => {
      it(`class ".${className}" exists — ${description}`, () => {
        const els = querySelectorAll(`.${className}`);
        expect(els.length, `No element with class="${className}" found in HTML`).toBeGreaterThan(0);
      });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4. 独立绑定控件（不走 data-setting 泛化机制）
  // ═════════════════════════════════════════════════════════════════════════

  describe('独立绑定控件', () => {
    it('floatingButtonEnabledOptions — 浮动球开关（checkbox，无 data-setting）', () => {
      const el = getById('floatingButtonEnabledOptions');
      expect(el).not.toBeNull();
      expect(el!.tagName.toLowerCase()).toBe('input');
      expect(el!.getAttribute('type')).toBe('checkbox');
      expect(el!.getAttribute('data-setting')).toBeNull();
    });

    it('floatingButtonColorSelect — 浮动球颜色（custom-select-wrapper，无 data-setting）', () => {
      const el = getById('floatingButtonColorSelect');
      expect(el).not.toBeNull();
      expect(el!.classList.contains('custom-select-wrapper')).toBe(true);
      expect(el!.getAttribute('data-setting')).toBeNull();
    });

    it('icon-variant-picker — 浮动球样式（空容器，JS 填充）', () => {
      const el = getById('icon-variant-picker');
      expect(el).not.toBeNull();
      // 应该是空容器（JS 动态填充）
      expect(el!.children.length, 'icon-variant-picker should be empty (JS populated)').toBe(0);
    });

    it('fullPageTranslationProviderSelect — 全页翻译引擎（select，无 data-setting）', () => {
      const el = getById('fullPageTranslationProviderSelect');
      expect(el).not.toBeNull();
      expect(el!.tagName.toLowerCase()).toBe('select');
      expect(el!.getAttribute('data-setting')).toBeNull();
    });

    it('wordTranslationProviderSelect — 划词翻译引擎（select，无 data-setting）', () => {
      const el = getById('wordTranslationProviderSelect');
      expect(el).not.toBeNull();
      expect(el!.tagName.toLowerCase()).toBe('select');
      expect(el!.getAttribute('data-setting')).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5. 特殊结构验证
  // ═════════════════════════════════════════════════════════════════════════

  describe('特殊结构验证', () => {
    it('html 根元素初始有 loading class（防 FOUC）', () => {
      const html = document.documentElement;
      expect(html.classList.contains('loading')).toBe(true);
    });

    it('doubleClickSentenceTriggerKey select 为空壳（JS 填充 option）', () => {
      const el = getById('doubleClickSentenceTriggerKey') as HTMLSelectElement;
      expect(el).not.toBeNull();
      expect(el!.tagName.toLowerCase()).toBe('select');
      // select 应该没有静态 option（JS 根据 OS 动态填充）
      expect(el!.options.length, 'doubleClickSentenceTriggerKey should have no static options').toBe(0);
    });

    it('nav-item 数量为 6（6 个 section 导航）', () => {
      const navItems = querySelectorAll('.nav-item[data-section]');
      expect(navItems.length).toBe(6);
    });

    it('每个 nav-item 的 data-section 与对应 section id 一一对应', () => {
      const navItems = querySelectorAll('.nav-item[data-section]');
      navItems.forEach((item) => {
        const section = item.getAttribute('data-section');
        expect(section).not.toBeNull();
        const target = getById(section!);
        expect(target, `Section id="${section}" referenced by nav-item not found`).not.toBeNull();
        expect(target!.classList.contains('settings-section')).toBe(true);
      });
    });

    it('初始 active section 为 general-settings', () => {
      const activeSection = querySelectorAll('.settings-section.active');
      expect(activeSection.length).toBe(1);
      expect(activeSection[0].id).toBe('general-settings');
    });

    it('初始 active nav-item 指向 general-settings', () => {
      const activeNav = querySelectorAll('.nav-item.active');
      expect(activeNav.length).toBe(1);
      expect(activeNav[0].getAttribute('data-section')).toBe('general-settings');
    });

    it('custom-select-wrapper[data-setting] 恰好 4 个（4 个颜色选择器）', () => {
      const wrappers = querySelectorAll('.custom-select-wrapper[data-setting]');
      expect(wrappers.length).toBe(4);
      const settings = wrappers.map((w) => w.getAttribute('data-setting'));
      expect(settings).toContain('wordUnderlineColorV2');
      expect(settings).toContain('sentenceUnderlineColor');
      expect(settings).toContain('fullTranslateLightColor');
      expect(settings).toContain('fullTranslateDarkColor');
    });

    it('iconColor radio 有 8 个不同 value（pink/blue/purple/green/orange/red/teal/indigo）', () => {
      const radios = querySelectorAll('input[type="radio"][data-setting="iconColor"]');
      const values = radios.map((r) => r.getAttribute('value')).sort();
      expect(values).toEqual(['blue', 'green', 'indigo', 'orange', 'pink', 'purple', 'red', 'teal']);
    });

    it('networkRegion radio 有 3 个不同 value（auto/china/global）', () => {
      const radios = querySelectorAll('input[type="radio"][data-setting="networkRegion"]');
      const values = radios.map((r) => r.getAttribute('value')).sort();
      expect(values).toEqual(['auto', 'china', 'global']);
    });

    it('所有 toggle-switch 内部都有一个 checkbox input', () => {
      const switches = querySelectorAll('.toggle-switch');
      expect(switches.length).toBeGreaterThan(0);
      switches.forEach((sw) => {
        const input = sw.querySelector('input[type="checkbox"]');
        expect(input, 'toggle-switch missing checkbox input').not.toBeNull();
      });
    });

    it('feature-dot 位于 singleClickTranslate 的 setting-item 内部', () => {
      const dot = querySelectorAll('.feature-dot');
      expect(dot.length).toBe(1);
      const parent = dot[0].closest('.setting-item');
      expect(parent).not.toBeNull();
      const checkbox = parent!.querySelector('#singleClickTranslate');
      expect(checkbox, 'feature-dot should be inside setting-item containing singleClickTranslate').not.toBeNull();
    });
  });
});
