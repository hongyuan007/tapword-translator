# Markdown Rendering in Sidepanel Chat — Technical Spec

**Date**: 2026-04-05  
**Module**: `src/13_sidepanel`  
**Status**: Draft

---

## 1. Current State Analysis

### 1.1 Text Rendering Pipeline

LLM output flows through the following chain:

```
AgentLoop.runAgent()
  │  stream.on("text", (delta, snapshot) => callbacks.onTextUpdate(delta, snapshot))
  ▼
useAgentChat  (hook — manages React state)
  │  onTextUpdate → appendBlock({ type: "text", content: snapshot, isStreaming: true })
  │               → updateLastBlock({ content: snapshot })
  ▼
MessageList.tsx  (renders ChatMessage[])
  ▼
MessageBubble.tsx  (switches on message.role, delegates block rendering)
  ▼
renderBlock()  (inline function in MessageBubble.tsx)
  │  case "text":  →  <div className="whitespace-pre-wrap break-words">{block.content}</div>
  │  case "thinking": →  <ThinkingCard />
  │  case "tool_call": →  <ToolCallCard />
```

### 1.2 Current Text Block Rendering (Verbatim)

From `MessageBubble.tsx`, `renderBlock()` for `type: "text"`:

```tsx
<div
    key={index}
    className={`rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
        isError
            ? "bg-red-50 text-red-800 rounded-bl-md border border-red-200"
            : "bg-white text-stone-800 rounded-bl-md border border-stone-200"
    }`}
>
    {block.content || (block.isStreaming && <span className="text-stone-400 italic text-xs">…</span>)}
</div>
```

Key observations:
- **Plain text only** — content is rendered as a raw React text node inside a `<div>`.
- **`whitespace-pre-wrap`** preserves newlines and spaces but does not interpret any Markdown syntax.
- **No Markdown parsing** — headings, bold, code blocks, lists, links, and tables all appear as raw text.
- The same pattern applies to the fallback path (assistant messages without blocks).

### 1.3 Content Block Types

From `types.ts`:

```typescript
interface TextBlock {
    type: "text"
    content: string          // raw LLM output text (may contain Markdown)
    isStreaming: boolean      // true while content is still being appended
}
```

- `content` accumulates via `snapshot` (full text so far) on each `onTextUpdate` callback.
- After the agent loop finishes, `isStreaming` is set to `false`.
- The `ChatMessage.content` field is a denormalized join of all `TextBlock.content` values (used for persistence and history restoration).

### 1.4 Styling Infrastructure

- **Tailwind CSS v4.2** via `@tailwindcss/vite` plugin.
- Sidepanel styles: single file `sidepanel.css` containing only `@import "tailwindcss"`.
- No `@tailwindcss/typography` plugin currently installed.

### 1.5 Bundle Size Baseline

| Asset | Size (dev) | Gzip |
|-------|-----------|------|
| `sidepanel.js` | 571 kB | 166 kB |
| `SkillStorageService.css` | 28 kB | 6 kB |
| **Total dist/** | **5.6 MB** | — |

The sidepanel JS bundle is already over the 500 kB warning threshold. Bundle size is a meaningful constraint.

---

## 2. Library Evaluation

### 2.1 Option A: `react-markdown` + `remark-gfm` (Recommended)

| Package | Unpacked | Minified (bundlephobia est.) | Notes |
|---------|----------|------------------------------|-------|
| `react-markdown` | 53 kB | ~12 kB gzip | React component, renders AST to React elements |
| `remark-gfm` | 22 kB | ~3 kB gzip | Tables, strikethrough, autolinks, task lists |
| `rehype-highlight` | 26 kB | ~2 kB gzip (core) | Optional — syntax highlighting via highlight.js |
| `highlight.js` (subset) | 5.4 MB full | ~10-20 kB gzip (6 languages) | Only needed if code highlighting desired |

**Total estimated addition**: ~15-17 kB gzip (without code highlighting), ~30-35 kB gzip (with 6-language highlight subset).

**Pros**:
- **Industry standard** for React Markdown — used by ChatGPT web, Vercel AI SDK, and most React-based agent UIs.
- **Safe by default** — renders to React elements via AST, no `dangerouslySetInnerHTML`. Immune to XSS without extra libraries.
- **Streaming-friendly** — re-renders efficiently on every content update; partial Markdown (e.g., an unclosed `**bold`) gracefully degrades to raw text until complete.
- **Plugin ecosystem** — remark/rehype plugins for tables (GFM), math (KaTeX), syntax highlighting, etc.
- **Tree-shakeable** — only the used remark/rehype plugins are bundled.

**Cons**:
- Adds ~15 kB gzip to the sidepanel bundle (acceptable given current 166 kB).
- Re-parsing the full Markdown AST on every streaming delta could be a micro-perf concern for very long messages, but in practice this is negligible for chat-length content.

### 2.2 Option B: `marked` + `DOMPurify`

| Package | Unpacked | Minified (bundlephobia est.) | Notes |
|---------|----------|------------------------------|-------|
| `marked` | 445 kB | ~12 kB gzip | String-to-HTML Markdown parser |
| `dompurify` | — | ~7 kB gzip | Required for XSS sanitization |

**Total estimated addition**: ~19 kB gzip.

**Pros**:
- Fast regex-based parser.
- Framework agnostic.

**Cons**:
- **Requires `dangerouslySetInnerHTML`** — rendered HTML must be inserted via `dangerouslySetInnerHTML`, breaking React's DOM model.
- **Requires DOMPurify** — extra dependency and careful configuration to prevent XSS.
- **React integration friction** — custom components (e.g., styled code blocks, link behavior) require post-processing the HTML string, which is awkward compared to `react-markdown`'s component mapping.
- **Streaming hazard** — partial HTML from incomplete Markdown can cause broken DOM if not carefully buffered.

**Verdict**: Not recommended for a React project.

### 2.3 Option C: Manual Regex / Minimal Parser

Build a lightweight Markdown subset renderer (bold, code, links only) with regex.

**Pros**:
- Zero dependency, minimal bundle impact.

**Cons**:
- Fragile, hard to maintain, incomplete Markdown support.
- Reinventing the wheel — would need to handle edge cases (nested formatting, escaping) that `react-markdown` already solves.
- No GFM tables, no syntax highlighting, no future extensibility.

**Verdict**: Not recommended unless extreme bundle budget.

### 2.4 Comparison Summary

| Criterion | react-markdown | marked + DOMPurify | Manual regex |
|-----------|---------------|-------------------|--------------|
| Bundle size (gzip) | ~15 kB | ~19 kB | ~0 kB |
| XSS safety | ✅ Built-in | ⚠️ Needs DOMPurify | ⚠️ Manual |
| React integration | ✅ Native | ❌ dangerouslySetInnerHTML | ⚠️ Custom |
| Streaming support | ✅ Re-render on update | ⚠️ Partial HTML risk | ⚠️ Limited |
| GFM (tables, tasks) | ✅ Plugin | ✅ Built-in | ❌ Not feasible |
| Code highlighting | ✅ rehype-highlight | ✅ highlight.js | ❌ Not feasible |
| Custom components | ✅ `components` prop | ❌ Post-process HTML | ⚠️ Manual |
| Maintenance burden | Low | Medium | High |

---

## 3. Recommended Approach

### 3.1 Core Decision: Treat All LLM Output as Markdown

Following the standard established by ChatGPT, Claude, and virtually all modern agent UIs: **render all `TextBlock.content` through a Markdown renderer**. If the LLM outputs plain text, Markdown rendering displays it as a normal paragraph — there is no downside.

No Markdown-vs-plain-text detection heuristic is needed.

### 3.2 Library Stack

| Package | Version | Purpose |
|---------|---------|---------|
| `react-markdown` | ^10.x | Core Markdown → React renderer |
| `remark-gfm` | ^4.x | GFM: tables, strikethrough, task lists, autolinks |

**Deferred (Phase 2)**:
| Package | Purpose |
|---------|---------|
| `rehype-highlight` | Syntax highlighting for code blocks |
| `highlight.js` (subset) | Language grammars (JS, Python, HTML, CSS, JSON, Bash) |

### 3.3 Why Defer Syntax Highlighting

- Code blocks will render correctly without highlighting (monospace font, background color, horizontal scroll).
- highlight.js contributes the majority of the bundle impact (~10-20 kB gzip even with a language subset).
- Syntax highlighting can be added later as a non-breaking enhancement.

---

## 4. Implementation Plan

### 4.1 New Files

| File | Purpose |
|------|---------|
| `src/13_sidepanel/components/MarkdownBlock.tsx` | New component wrapping `<ReactMarkdown>` with remark plugins and custom component overrides |
| `src/13_sidepanel/styles/markdown.css` | Markdown-specific styles (or Tailwind `@apply` rules) for rendered elements |

### 4.2 Modified Files

| File | Change |
|------|--------|
| `src/13_sidepanel/components/MessageBubble.tsx` | Replace inline `{block.content}` text rendering in `renderBlock()` with `<MarkdownBlock content={block.content} isStreaming={block.isStreaming} />` |
| `src/13_sidepanel/styles/sidepanel.css` | Import `markdown.css` |
| `package.json` | Add `react-markdown`, `remark-gfm` dependencies |

### 4.3 Component Design: `MarkdownBlock`

```tsx
// Conceptual interface (not implementation code)
interface MarkdownBlockProps {
    content: string
    isStreaming: boolean
}
```

Responsibilities:
1. Render `content` via `<ReactMarkdown>` with `remarkGfm` plugin.
2. Provide custom component overrides via `components` prop:
   - **`code`**: Distinguish inline code vs. fenced code blocks. Apply monospace styling. Render fenced blocks in a scrollable `<pre>` container.
   - **`a`**: Open links in new tab (`target="_blank"`, `rel="noopener noreferrer"`).
   - **`table`**: Add horizontal scroll wrapper for wide tables.
   - **`p`**: Standard paragraph with appropriate margins.
3. When `isStreaming` is true and content is empty, render a "…" typing indicator (same as current behavior).

### 4.4 Integration Point in `renderBlock()`

Current:
```tsx
case "text":
    return (
        <div key={index} className={`rounded-xl px-3 py-2 text-sm ...`}>
            {block.content || (block.isStreaming && <span>…</span>)}
        </div>
    )
```

After:
```tsx
case "text":
    return (
        <div key={index} className={`rounded-xl px-3 py-2 text-sm ...`}>
            {block.content
                ? <MarkdownBlock content={block.content} isStreaming={block.isStreaming} />
                : (block.isStreaming && <span>…</span>)
            }
        </div>
    )
```

The outer bubble styling (background, border, border-radius) remains unchanged. `MarkdownBlock` only controls the inner content rendering.

---

## 5. Styling Strategy

### 5.1 Approach: Custom CSS with Tailwind Utilities (Scoped)

Rather than installing `@tailwindcss/typography` (the `prose` plugin), define scoped styles for Markdown output. Reasons:

- **Control** — the `prose` defaults are designed for article-length content and may be too spacious for chat bubbles. Chat UI needs compact spacing.
- **Bundle** — avoid pulling in the full typography plugin for a single component.
- **Scope** — styles only apply within `.markdown-body` class, preventing leakage to other UI.

### 5.2 Style Rules (in `markdown.css`)

Target the rendered Markdown container with a `.markdown-body` class:

| Element | Style Notes |
|---------|-------------|
| `p` | `margin-bottom: 0.5em; &:last-child { margin-bottom: 0 }` — compact paragraph spacing |
| `h1-h6` | `font-weight: 600; margin-top: 0.75em; margin-bottom: 0.25em` — visible but compact |
| `strong` | `font-weight: 600` |
| `em` | `font-style: italic` |
| `code` (inline) | `background: stone-100; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.85em` |
| `pre > code` (block) | `display: block; background: stone-900; color: stone-100; padding: 0.75em; border-radius: 6px; overflow-x: auto; font-size: 0.8em` |
| `ul`, `ol` | `padding-left: 1.25em; margin-bottom: 0.5em` |
| `li` | `margin-bottom: 0.15em` |
| `blockquote` | `border-left: 3px solid stone-300; padding-left: 0.75em; color: stone-500; font-style: italic` |
| `a` | `color: blue-600; text-decoration: underline` |
| `table` | `border-collapse: collapse; width: 100%; font-size: 0.8em` |
| `th`, `td` | `border: 1px solid stone-200; padding: 0.3em 0.5em; text-align: left` |
| `hr` | `border-top: 1px solid stone-200; margin: 0.75em 0` |

### 5.3 Removing `whitespace-pre-wrap`

The current `whitespace-pre-wrap` CSS must be **removed** from the text block container when Markdown rendering is active. Markdown paragraph elements handle their own whitespace. Keeping `whitespace-pre-wrap` would cause double line breaks and broken layout inside Markdown-rendered content.

---

## 6. Streaming Considerations

### 6.1 How Streaming Works Today

1. `AgentLoop` emits `onTextUpdate(delta, snapshot)` on each SSE text chunk.
2. `useAgentChat` updates the `TextBlock.content` with the full `snapshot` string.
3. React re-renders `MessageBubble` → `renderBlock()` → displays `block.content`.

This means the entire content string is replaced on every delta. `react-markdown` will re-parse the full Markdown AST on each update.

### 6.2 Performance Impact

- **Chat-length content** (< 5,000 chars): Negligible. `react-markdown` parsing is fast (~1-2ms for typical message lengths). React's VDOM diffing minimizes actual DOM updates.
- **Very long content** (> 10,000 chars): Could cause perceptible jank if deltas arrive rapidly (e.g., every 20-50ms). Mitigation options below.

### 6.3 Mitigation: Debounced Re-render (If Needed)

If profiling reveals jank during streaming of long messages:

1. **Throttle Markdown re-parsing** — keep a `rawContent` state that updates on every delta, but only pass it to `<ReactMarkdown>` via a throttled value (e.g., every 100ms during streaming, immediate on completion).
2. **Fallback during streaming** — render as plain `whitespace-pre-wrap` while `isStreaming === true`, switch to Markdown on completion. This is the simplest approach but means users don't see formatted Markdown until the stream ends.

Recommendation: Start without any debouncing. Add throttling only if real-world profiling shows a problem.

### 6.4 Partial Markdown Graceful Degradation

`react-markdown` handles incomplete Markdown gracefully:

| Partial State | Rendered As |
|--------------|-------------|
| `**bold` (unclosed) | Raw text `**bold` |
| `` ``` `` (unclosed code fence) | Raw text with backticks (or code block depending on parser behavior) |
| `| table |` (incomplete) | Raw text of the partial table |
| `# Heading` | Heading (immediately, since it's line-complete) |
| `- list item` | List item (immediately) |

This is acceptable behavior — partial syntax appears as raw text and then "snaps" into formatted rendering once the Markdown structure is completed by subsequent streaming deltas.

---

## 7. Security Analysis

### 7.1 XSS Prevention

| Vector | Risk | Mitigation |
|--------|------|------------|
| LLM outputs `<script>` | None | `react-markdown` does **not** render raw HTML by default. HTML tags in Markdown source are escaped. |
| LLM outputs `<img onerror="...">` | None | Same as above — raw HTML is not rendered. |
| `javascript:` URLs in links | Low | `react-markdown` strips `javascript:` protocol by default (via `micromark`). Can add explicit `allowedSchemes` config. |
| Markdown link with malicious href | Low | Custom `<a>` component override adds `rel="noopener noreferrer"` and `target="_blank"`. |

### 7.2 Content Security Policy (CSP)

The sidepanel runs inside the extension's own page (`sidepanel.html`), not a web page content script. The extension's CSP (from `manifest.json`) applies. Since `react-markdown` does not use `eval()`, `new Function()`, or inline styles via `dangerouslySetInnerHTML`, there are **no CSP conflicts**.

### 7.3 `rehype-raw` Warning

The `rehype-raw` plugin (which enables raw HTML passthrough in Markdown) must **never** be used in this context. It would allow LLM-generated HTML to be rendered directly, creating an XSS surface. This should be documented as a hard rule.

---

## 8. Open Questions / Future Considerations

1. **Code block copy button** — Should we add a "Copy" button to fenced code blocks? Common in ChatGPT-style UIs. Can be implemented via the custom `code` component override.
2. **Math rendering** — If LLM outputs LaTeX math (`$...$`, `$$...$$`), we could add `remark-math` + `rehype-katex` plugins later. Not needed for initial launch.
3. **Image rendering** — `react-markdown` renders `![alt](src)` as `<img>` by default. For security, the custom `img` component could restrict allowed domains or disable images entirely.
4. **Thinking block Markdown** — Should `ThinkingCard` content also be rendered as Markdown? Currently it uses `whitespace-pre-wrap`. This is a separate decision; thinking blocks are typically raw internal reasoning and may not benefit from formatting.
5. **Dark mode** — The sidepanel does not currently have a dark theme, but the markdown styles should be designed with future dark mode support in mind (use Tailwind color tokens rather than hardcoded hex values).

---

## 9. Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Rendering strategy | All text → Markdown | Industry standard; plain text renders correctly through Markdown |
| Core library | `react-markdown` ^10.x | Safe, React-native, streaming-friendly, small bundle |
| GFM support | `remark-gfm` ^4.x | Tables, strikethrough, task lists |
| Syntax highlighting | Deferred (Phase 2) | Code blocks work without it; saves ~10-20 kB gzip |
| Styling | Custom scoped CSS (`.markdown-body`) | Compact chat-optimized spacing, no typography plugin bloat |
| Streaming | Re-render on every update, no debouncing initially | Simple; add throttling only if profiling shows jank |
| Security | Default `react-markdown` (no `rehype-raw`) | XSS-safe out of the box |
| Bundle impact | ~15 kB gzip added to sidepanel.js | Acceptable (currently 166 kB gzip) |

### Files to Create
- `src/13_sidepanel/components/MarkdownBlock.tsx`
- `src/13_sidepanel/styles/markdown.css`

### Files to Modify
- `src/13_sidepanel/components/MessageBubble.tsx`
- `src/13_sidepanel/styles/sidepanel.css`
- `package.json`
