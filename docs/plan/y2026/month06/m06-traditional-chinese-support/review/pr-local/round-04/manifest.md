# Round-04 Review Manifest

## Review Scope

Round-04 修复 1 个 P1 问题：`og:locale` 与 `content-language` 冲突时仍采纳弱 metadata。

这是 Round-03 Reviewer A 报告中的 P1-2 遗留项。修复涉及 2 个文件中各自独立的 `getPageDeclaredLanguage()` 函数，逻辑完全相同。

## Changed Files

| # | File | Function | Lines (approx.) |
|---|------|----------|-----------------|
| 1 | `src/1_content/utils/pageLanguageChecker.ts` | `getPageDeclaredLanguage()` | 38-51 |
| 2 | `src/1_content/utils/languageValidator.ts` | `getPageDeclaredLanguage()` | 23-43 |

## The Fix

**问题：** 当页面没有 `html lang` / `xml:lang`，但同时存在 `og:locale` 和 `content-language` meta 标签且两者值不一致时，原代码仍会 fall through 到 `return ogLocale || contentLanguage || ""`，采纳冲突的弱 metadata，可能导致页面语言误判。

**修复逻辑：** 在两个 meta 值同时存在时，仅当它们一致才返回；不一致时返回空字符串，让下游内容检测接管：

```ts
if (ogLocale && contentLanguage) {
    return ogLocale === contentLanguage ? ogLocale : ""
}
return ogLocale || contentLanguage || ""
```

## Current Code (post-fix)

### `pageLanguageChecker.ts` — `getPageDeclaredLanguage()`

```ts
function getPageDeclaredLanguage(): string {
    if (typeof document === 'undefined') return '';

    const htmlLang = normalizeLangTag(document.documentElement.lang);
    if (htmlLang) return htmlLang;

    const xmlLang = normalizeLangTag(document.documentElement.getAttribute('xml:lang'));
    if (xmlLang) return xmlLang;

    const ogLocale = normalizeLocaleMeta(
        document.querySelector('meta[property="og:locale"]')?.getAttribute('content')
    );
    const contentLanguage = normalizeLocaleMeta(
        document.querySelector('meta[http-equiv="content-language"]')?.getAttribute('content')
    );

    // Only trust meta tags when they agree; conflicting signals are unreliable
    if (ogLocale && contentLanguage) {
        return ogLocale === contentLanguage ? ogLocale : '';
    }

    return ogLocale || contentLanguage || '';
}
```

### `languageValidator.ts` — `getPageDeclaredLanguage()`

```ts
function getPageDeclaredLanguage(): string {
    if (typeof document === "undefined") return ""

    const htmlLang = normalizeLanguageTagFull(document.documentElement.lang)
    if (htmlLang) {
        return htmlLang
    }

    const xmlLang = normalizeLanguageTagFull(document.documentElement.getAttribute("xml:lang"))
    if (xmlLang) {
        return xmlLang
    }

    const ogLocale = normalizeLocaleMeta(document.querySelector('meta[property="og:locale"]')?.getAttribute("content"))
    const contentLanguage = normalizeLocaleMeta(document.querySelector('meta[http-equiv="content-language"]')?.getAttribute("content"))

    if (ogLocale && contentLanguage) {
        // Only trust meta tags when they agree; conflicting signals are unreliable
        return ogLocale === contentLanguage ? ogLocale : ""
    }

    return ogLocale || contentLanguage || ""
}
```

## Git Diff

修复已合并到 `feat/260613/traditional-chinese-support` 分支，diff 从 HEAD~3 可见。以下是与 Round-04 直接相关的 diff 片段（仅展示冲突检查部分，完整 diff 还包含 Traditional Chinese 支持的其他变更）：

### `pageLanguageChecker.ts` (new file in this branch)

```diff
+    // Only trust meta tags when they agree; conflicting signals are unreliable
+    if (ogLocale && contentLanguage) {
+        return ogLocale === contentLanguage ? ogLocale : '';
+    }
+
     return ogLocale || contentLanguage || '';
```

**注意：** `pageLanguageChecker.ts` 是本 feature 分支新增文件，整个文件内容都是 new code。冲突检查逻辑在文件创建时已包含。

### `languageValidator.ts` (modified)

```diff
-    if (ogLocale && contentLanguage && ogLocale === contentLanguage) {
-        return ogLocale
+    if (ogLocale && contentLanguage) {
+        // Only trust meta tags when they agree; conflicting signals are unreliable
+        return ogLocale === contentLanguage ? ogLocale : ""
     }
 
     return ogLocale || contentLanguage || ""
```

**变更说明：** 原代码 `if (ogLocale && contentLanguage && ogLocale === contentLanguage)` 只在三者条件全满足时提前返回 ogLocale，但不一致时会 fall through 到 `return ogLocale || contentLanguage || ""`，仍采纳冲突的弱 metadata。修复后改为：两者同时存在时，一致则返回，不一致则返回空字符串。

## Original Issue (from Round-03 Reviewer A)

> **P1-2** `[src/1_content/utils/pageLanguageChecker.ts:46-51]` / `[src/1_content/utils/languageValidator.ts:37-41]` `og:locale` 与 `content-language` 冲突时仍会采纳其中一个弱 metadata
>
> 当前代码只在两者相等时提前 `return`，但不相等时仍执行 `return ogLocale || contentLanguage || ""`。因此页面没有 `html lang/xml:lang`、但存在冲突 meta（例如 `og:locale=zh_TW`、`content-language=en`）时，`pageLanguageChecker` 会直接把页面判为繁体中文并隐藏浮动按钮；`languageValidator` 也可能对英文选择提前抑制翻译。P1-2 明确要求加入 `ogLocale===contentLanguage` 一致性检查，当前实现没有真正阻止冲突 metadata 造成误判。
>
> 建议改为：当两者同时存在时，仅在相等时返回；不相等时返回空串并继续走内容检测/异步检测。例如：
>
> ```ts
> if (ogLocale && contentLanguage) {
>     return ogLocale === contentLanguage ? ogLocale : ""
> }
> return ogLocale || contentLanguage || ""
> ```

## Related Tests

### Test Files

| # | File | Scope |
|---|------|-------|
| 1 | `tests/1_content/utils/languageValidator.unit.test.ts` | Unit tests for `shouldTriggerTranslationAsync()` including `getPageDeclaredLanguage()` behavior |
| 2 | `tests/1_content/utils/languageValidator.traditional-chinese.test.ts` | Traditional Chinese specific tests for `shouldTriggerTranslationAsync()` |

### Key Test Cases Related to `getPageDeclaredLanguage()`

**From `languageValidator.unit.test.ts` — "Page Metadata Detection" describe block:**

1. `"suppresses when html lang declares zh"` — htmlLang=zh-CN, target=zh → false
2. `"uses xml:lang when html lang is missing"` — xmlLang=zh-CN, target=zh → false
3. `"uses og:locale when html metadata is absent"` — ogLocale=zh_CN, target=zh → false
4. `"uses content-language when stronger metadata is absent"` — contentLanguage=zh-CN,en, target=zh → false
5. `"does not let weaker metadata override html lang"` — htmlLang=en + ogLocale=zh_CN + contentLanguage=zh-CN, target=zh → true (html lang wins)

**From `languageValidator.traditional-chinese.test.ts`:**

6. `"Simplified Chinese page (zh-CN) + English selection + zh-Hant target → true"` — htmlLang=zh-CN, target=zh-Hant → true
7. `"Traditional Chinese page (zh-TW) + English selection + zh-Hant target → false"` — htmlLang=zh-TW, target=zh-Hant → false
8. Various regression tests for simplified/traditional differentiation

**Note:** 目前没有专门针对 `ogLocale` 与 `contentLanguage` 冲突场景（两者同时存在但值不同）的测试用例。Review 时应关注是否需要补充此类测试。

## Review Checklist

- [ ] Conflict check logic is correct: when `ogLocale` && `contentLanguage` exist but differ, return `""` (empty string)
- [ ] Empty string return allows downstream content detection (`detectLanguageFromContent()` / `detectSourceLanguageAsync()`) to take over
- [ ] No new imports or dependencies introduced by this fix
- [ ] Code style consistent with surrounding code (naming, formatting, quote style per file)
- [ ] Both files (`pageLanguageChecker.ts` and `languageValidator.ts`) have identical fix logic
- [ ] No edge cases missed (e.g., null/undefined handling after `normalizeLocaleMeta` — `normalizeLocaleMeta` already returns `""` for null/undefined, so `ogLocale && contentLanguage` guard is safe)
- [ ] Consider whether a dedicated test case for conflicting meta tags should be added
