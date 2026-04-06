# Technical Spec: `fetch_url` and `search_files` Tools for Sidepanel Agent

**Date**: 2026-07-14  
**Status**: Draft  
**Module**: `src/13_sidepanel/agent/tools/`

---

## 1. Research Summary

### 1.1 fetch_url — Industry Patterns

| Source | Key Pattern | Adopted? |
|--------|-------------|----------|
| **MCP Fetch Server** (`mcp-server-fetch`) | Uses `readabilipy` + `markdownify` for HTML→Markdown. Parameters: `url`, `max_length` (default 5000), `start_index` (for pagination), `raw` (skip conversion). 30s timeout. Truncation with helpful "call again with start_index=N" prompts. | ✅ Adopt: markdown conversion, max_length, start_index pagination, timeout, truncation prompt |
| **Jina Reader API** (`r.jina.ai`) | SaaS endpoint that converts URLs to clean markdown. Returns `response.data.content`. Rich headers: `X-Return-Format`, `X-Target-Selector`, `X-Remove-Selector`, `X-Timeout`. | ⚠️ Reference only — external API dependency not acceptable for offline/free usage. Adopt the concept of content-focused extraction. |
| **OpenAI browse patterns** | Typically: fetch → extract readable content → truncate to token budget → return as tool result. | ✅ Adopt pipeline pattern |
| **Common best practice** | HTML as-is is token-wasteful for LLMs. Markdown conversion reduces tokens by 60-80% while preserving structure. Main content extraction (readability) removes nav/footer noise. | ✅ Adopt: readability + markdown is the gold standard |

**Key decision: HTML-to-Markdown library selection**

Since we run in a browser context (Chrome extension sidepanel/background), Python libraries (`readabilipy`, `markdownify`) are unavailable. Browser-compatible alternatives:

| Library | Size | Purpose | Notes |
|---------|------|---------|-------|
| `@mozilla/readability` | ~30KB | Extract main article content from HTML DOM | The industry standard (used by Firefox Reader View). Requires a DOM document. |
| `turndown` | ~15KB | Convert HTML to Markdown | Most popular HTML→MD library for JS. Rich plugin system. |

**Recommendation**: Use `@mozilla/readability` for main content extraction + `turndown` for Markdown conversion. This mirrors the MCP server's `readabilipy` + `markdownify` pipeline but in browser-compatible form.

### 1.2 search_files — Industry Patterns

| Source | Key Pattern | Adopted? |
|--------|-------------|----------|
| **VS Code Copilot `grep_search`** | Parameters: `query`, `isRegexp`, `includePattern` (glob), `maxResults`. Returns matches with file path, line number, and context snippet. Case-insensitive by default. | ✅ Adopt: same parameter shape, line-number context format |
| **MCP Filesystem Server** | Provides `search_files` with `path` (root dir) and `pattern` (regex). Recursively walks directory tree. Returns matching file paths. | ✅ Adopt: directory-scoped recursive search |
| **Common grep tools** | Return format: `filepath:lineNumber: matched line`. Include N lines of context before/after for readability. | ✅ Adopt: filepath + line number + context snippet format |

**Key decision: Search scope**

Our VFS (OPFS) has no native search/grep capability. Implementation requires:
1. Recursively list all files under a given path
2. Read each file's content
3. Perform line-by-line text/regex matching
4. Collect and format results

This is acceptable for the expected VFS size (skills + knowledge files, typically <100 files, <1MB total).

---

## 2. `fetch_url` Tool Design

### 2.1 Tool Definition

```typescript
name: "fetch_url"
description: "Fetch a URL from the internet and return its contents as markdown text. " +
    "Useful for reading documentation, articles, or any web page. " +
    "HTML pages are automatically converted to clean markdown for readability. " +
    "Non-HTML content (JSON, plain text, etc.) is returned as-is."
```

### 2.2 Input Schema

```typescript
input_schema: {
    type: "object",
    properties: {
        url: {
            type: "string",
            description: "The URL to fetch (must start with http:// or https://)"
        },
        max_length: {
            type: "number",
            description: "Maximum number of characters to return (default: 20000). " +
                "Use a smaller value to save context window space."
        },
        start_index: {
            type: "number",
            description: "Start returning content from this character index (default: 0). " +
                "Use this to paginate through long pages when a previous fetch was truncated."
        },
        extract_main_content: {
            type: "boolean",
            description: "If true (default), extract only the main article content, " +
                "removing navigation, sidebars, footers, etc. Set to false for raw full-page content."
        }
    },
    required: ["url"]
}
```

### 2.3 Default Values

| Parameter | Default | Rationale |
|-----------|---------|-----------|
| `max_length` | 20000 | MCP uses 5000 (too small for real articles). 20K chars ≈ 5K tokens — fits well within Claude/Qwen context while preserving article substance. |
| `start_index` | 0 | Start from beginning |
| `extract_main_content` | true | Main content extraction reduces noise significantly. Agent can set `false` when full page structure is needed. |

### 2.4 Content Pipeline

```
┌─────────────┐     ┌───────────────────┐     ┌──────────────────┐     ┌────────────┐     ┌──────────┐
│  fetch URL   │────▶│ Detect content    │────▶│  Extract main    │────▶│  Convert   │────▶│ Truncate │
│ (background) │     │ type (HTML?)      │     │  content         │     │  to MD     │     │ & format │
└─────────────┘     └───────────────────┘     │  (@mozilla/      │     │ (turndown) │     └──────────┘
                         │                     │   readability)   │     └────────────┘
                         │ non-HTML             └──────────────────┘
                         │                         ▲
                         ▼                         │ skip if extract_main_content=false
                    Return raw text ◀──────────────┘
```

**Step-by-step:**

1. **Sidepanel → Background**: Send `FETCH_URL` message via `chrome.runtime.sendMessage` with `{ url, timeout }`.
2. **Background `fetch()`**: The background service worker performs the actual `fetch()`. It has broader CORS permissions via manifest `host_permissions`. Returns `{ success, content, contentType, statusCode }`.
3. **Detect content type**: Check `Content-Type` header and HTML heuristics (`<html` in first 200 chars).
4. **Extract main content** (HTML only, when `extract_main_content=true`): Parse HTML into DOM with `DOMParser`, run `@mozilla/readability`'s `Readability` to extract article content.
5. **Convert to Markdown** (HTML only): Use `turndown` to convert the (extracted or full) HTML to clean Markdown.
6. **Truncate**: Apply `start_index` and `max_length`. If truncated, append a helpful message: `\n\n[Content truncated. Call fetch_url with start_index={nextIndex} to continue reading.]`
7. **Return**: Formatted string with URL header and content.

### 2.5 CORS Strategy

**Problem**: The sidepanel runs at `chrome-extension://` origin. Most websites block cross-origin `fetch()` requests.

**Current `host_permissions`** in `src/manifest.json`:
```json
"host_permissions": [
    "https://*.bing.com/*",
    "https://dashscope.aliyuncs.com/*"
]
```

**Solution**: Delegate fetching to the background service worker and add `<all_urls>` to `host_permissions`.

**Why background worker?**
- The background service worker, when granted `host_permissions`, can fetch any URL without CORS restrictions because it's not a web page origin.
- The content script approach is scoped to the current tab's origin — too limited.
- Adding `<all_urls>` to `host_permissions` is standard for extensions that need web access (e.g., ad blockers, translators — TapWord already uses `"matches": ["<all_urls>"]` for content scripts).

**Message flow:**
```
Sidepanel                Background Service Worker           Remote Server
   │                              │                              │
   │── FETCH_URL {url} ──────────▶│                              │
   │                              │── fetch(url) ───────────────▶│
   │                              │◀── Response {html, status} ──│
   │◀── {success, content, ...} ──│                              │
   │                              │                              │
   │  (parse & convert in         │                              │
   │   sidepanel context)         │                              │
```

**Why parse in sidepanel, not background?**
- The background service worker is a Service Worker — it has no DOM (`DOMParser`, `document` are unavailable).
- `@mozilla/readability` requires a DOM document.
- The sidepanel is a full browser page context with DOM access.
- Alternative: use offscreen document for DOM processing, but adds unnecessary complexity. Sidepanel already has DOM access.

### 2.6 Error Handling

| Scenario | Behavior |
|----------|----------|
| Invalid URL (no http/https) | Return error string immediately, no network call |
| Network timeout (30s) | Return: `Error: Request timed out after 30 seconds.` |
| HTTP 4xx | Return: `Error: HTTP {status} — {statusText} when fetching {url}` |
| HTTP 5xx | Return: `Error: Server error {status} when fetching {url}` |
| Non-HTML content type | Return raw text with prefix: `Content-Type: {type}\n\n{content}` |
| Readability extraction fails | Fallback: convert full HTML to markdown (skip extraction) |
| Content is empty after extraction | Return: `The page at {url} returned no extractable content.` |
| Background message failure | Return: `Error: Failed to communicate with background service.` |

### 2.7 Output Format

```
Contents of {url}:

{markdown_content}

[Content truncated at 20000 characters. Call fetch_url with start_index=20000 to continue reading.]
```

For non-HTML:
```
Contents of {url} (Content-Type: application/json):

{raw_content}
```

---

## 3. `search_files` Tool Design

### 3.1 Tool Definition

```typescript
name: "search_files"
description: "Search for text patterns across files in the TapWord virtual filesystem. " +
    "Returns matching lines with file paths and line numbers. " +
    "Useful for finding specific content, function names, or patterns across skill files."
```

### 3.2 Input Schema

```typescript
input_schema: {
    type: "object",
    properties: {
        query: {
            type: "string",
            description: "The text or regex pattern to search for. Case-insensitive by default."
        },
        path: {
            type: "string",
            description: "Directory to search within (default: '/tapword/'). " +
                "Must start with '/tapword/'."
        },
        is_regexp: {
            type: "boolean",
            description: "If true, treat query as a regular expression. Default: false (plain text search)."
        },
        max_results: {
            type: "number",
            description: "Maximum number of matching lines to return (default: 20, max: 100)."
        }
    },
    required: ["query"]
}
```

### 3.3 Default Values

| Parameter | Default | Rationale |
|-----------|---------|-----------|
| `path` | `/tapword/` | Search entire VFS by default |
| `is_regexp` | false | Plain text is simpler and less error-prone for LLM usage |
| `max_results` | 20 | Balance between completeness and output size. VS Code Copilot's grep uses similar defaults. |

### 3.4 Search Algorithm

```
1. Recursively list all files under `path`
2. For each file:
   a. Read file content
   b. Split into lines
   c. For each line, test against query:
      - Plain text: line.toLowerCase().includes(query.toLowerCase())
      - Regex: new RegExp(query, 'i').test(line)
   d. For each match, collect:
      - File path
      - Line number (1-based)
      - The matched line (trimmed)
      - 1 line of context before and after
3. Stop when max_results matches are collected
4. Format and return
```

### 3.5 Recursive File Listing Helper

The existing `TapWordFS` has `listDir` (non-recursive, returns immediate children). We need a recursive helper:

```typescript
async function listFilesRecursive(dirPath: string): Promise<string[]> {
    const entries = await tapWordFS.listDir(dirPath)
    const files: string[] = []
    for (const entry of entries) {
        const fullPath = dirPath.endsWith("/") ? dirPath + entry.name : dirPath + "/" + entry.name
        if (entry.kind === "file") {
            files.push(fullPath)
        } else {
            const subFiles = await listFilesRecursive(fullPath)
            files.push(...subFiles)
        }
    }
    return files
}
```

> **Note**: `SkillStorageService.ts` already has a private `listFilesRecursive` helper. Consider extracting it to a shared utility or duplicating in the tool file to avoid cross-module coupling.

### 3.6 Return Format

```
Found {N} matches for "{query}" in {path}:

── /tapword/skills/e2e-testing/SKILL.md ──
  L12: ## Running Tests
  L45: Use `npx playwright test` to run the full suite.
  L46: For a single test: `npx playwright test tests/login.spec.ts`

── /tapword/skills/api-design/examples/rest.md ──
  L8: ### GET /api/users

{N} matches ({M} files searched)
```

If no matches:
```
No matches found for "{query}" in {path}. {M} files searched.
```

### 3.7 Performance Considerations

- **Expected VFS size**: <100 files, <1MB total. Full-scan search is acceptable.
- **Guard against large files**: Skip files >500KB (likely binary or data dumps). Log a warning.
- **Regex safety**: Wrap `new RegExp()` in try/catch to handle invalid patterns gracefully.
- **Timeout**: No explicit timeout needed given the small VFS size. If future VFS grows, consider adding a scan budget (max files to read).

---

## 4. Files to Create/Modify

### 4.1 New Files

| File | Purpose |
|------|---------|
| `src/13_sidepanel/agent/tools/fetchUrlTool.ts` | `fetch_url` tool implementation (tool definition + execute function). Includes HTML detection, readability extraction, turndown conversion, truncation logic. |
| `src/13_sidepanel/agent/tools/searchFilesTool.ts` | `search_files` tool implementation. Includes recursive file listing, text/regex matching, result formatting. |

### 4.2 Modified Files

| File | Change |
|------|--------|
| `src/13_sidepanel/agent/tools/index.ts` | Import and register `fetchUrlTool` and `searchFilesTool` in `TOOL_REGISTRY`. |
| `src/13_sidepanel/agent/prompts.ts` | Add `fetch_url` and `search_files` to the `# Workspace` / `# Tools` section of the system prompt. |
| `src/2_background/messaging/MessageRouter.ts` | Add `FETCH_URL` message handler that performs `fetch()` and returns response body + metadata. |
| `src/0_common/types/index.ts` (or MessageType) | Add `"FETCH_URL"` to the `MessageType` union type. |
| `src/manifest.json` | Add `"<all_urls>"` to `host_permissions` for fetch_url CORS support. |

### 4.3 File Dependency Graph

```
fetchUrlTool.ts ──uses──▶ chrome.runtime.sendMessage("FETCH_URL")
       │                        │
       │                        ▼
       │               MessageRouter.ts (background)
       │                  └── fetch(url)
       │
       ├──uses──▶ @mozilla/readability (Readability)
       └──uses──▶ turndown (TurndownService)

searchFilesTool.ts ──uses──▶ TapWordFS (listDir, readFile)
```

---

## 5. Dependencies

### 5.1 New NPM Packages

| Package | Version | Size | Purpose | Install |
|---------|---------|------|---------|---------|
| `@mozilla/readability` | ^0.5.0 | ~30KB | Extract main article content from HTML | `npm install @mozilla/readability` |
| `turndown` | ^7.2.0 | ~15KB | Convert HTML to Markdown | `npm install turndown` |

### 5.2 Type Declarations

| Package | Purpose | Install |
|---------|---------|---------|
| `@types/turndown` | TypeScript types for turndown | `npm install -D @types/turndown` |

> **Note**: `@mozilla/readability` ships its own TypeScript types — no extra `@types/` package needed.

### 5.3 No Dependencies Needed for `search_files`

The search tool is pure TypeScript, using only the existing `TapWordFS` APIs.

---

## 6. Verification Plan

### 6.1 `fetch_url` Test Cases

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| 1 | Fetch a simple HTML page (e.g., `https://example.com`) | Manual: agent chat | Returns markdown content with title and text |
| 2 | Fetch with `extract_main_content=false` | Manual | Returns full page markdown including nav/footer |
| 3 | Fetch a JSON API endpoint | Manual | Returns raw JSON as text |
| 4 | Fetch with `max_length=500` | Manual | Content truncated at 500 chars with "call again with start_index" prompt |
| 5 | Pagination: fetch with `start_index=500` after truncation | Manual | Returns content starting from char 500 |
| 6 | Fetch invalid URL (no protocol) | Manual | Returns error message, no crash |
| 7 | Fetch non-existent domain | Manual | Returns timeout/network error message |
| 8 | Fetch URL returning 404 | Manual | Returns HTTP error message |
| 9 | Readability extraction fails (malformed HTML) | Unit test | Falls back to full HTML → markdown conversion |
| 10 | Very large page (>100KB HTML) | Manual | Content truncated correctly, no memory issues |

### 6.2 `search_files` Test Cases

| # | Test Case | Method | Expected |
|---|-----------|--------|----------|
| 1 | Plain text search across all VFS files | Manual: agent chat | Returns matching lines with file paths and line numbers |
| 2 | Search with `path` filter for specific directory | Manual | Only searches within the specified directory |
| 3 | Regex search (e.g., `\bfunction\s+\w+`) | Manual | Returns regex matches |
| 4 | Invalid regex pattern | Manual | Returns friendly error, no crash |
| 5 | Search with no matches | Manual | Returns "No matches found" with file count |
| 6 | Search with `max_results=3` | Manual | Returns at most 3 matches |
| 7 | Search term in both file name and content | Manual | Matches based on content (line text), not file name |
| 8 | Empty VFS (no files) | Unit test | Returns "No matches found. 0 files searched." |
| 9 | Search in non-existent path | Manual | Returns error about invalid/empty path |
| 10 | Large file skip (>500KB) | Unit test | File is skipped, log warning |

### 6.3 Integration Tests

| # | Test Case | Expected |
|---|-----------|----------|
| 1 | Agent uses `fetch_url` in response to "summarize this page" for external URL | Agent fetches, converts, and summarizes |
| 2 | Agent uses `search_files` to find content in skills | Agent searches and reports results |
| 3 | Agent chains `search_files` → `read_file` | Agent finds match then reads full file for context |
| 4 | System prompt lists both new tools | Both tools appear in tool definitions sent to LLM |

---

## 7. Open Questions

| # | Question | Current Leaning | Impact |
|---|----------|-----------------|--------|
| 1 | Should `<all_urls>` be in `host_permissions` or `optional_host_permissions`? | `host_permissions` for simplicity. `optional_host_permissions` adds UX friction (permission prompt) but is more privacy-friendly. | Manifest change, possible permission prompt UX |
| 2 | Should we cache fetched URL content in VFS? | No — keep it stateless for V1. Agent can explicitly `write_file` if it wants to persist. | Future enhancement |
| 3 | Should `search_files` support glob patterns for file filtering (like `*.md`)? | No for V1 — keep it simple. Agent can use `path` to scope searches. | Future enhancement |
| 4 | Should the background fetch handler enforce a URL allowlist or blocklist? | No for V1. Trust the LLM's judgment + the user's oversight. Consider adding localhost/internal IP blocking for security. | Security consideration |

---

## Appendix A: MCP Fetch Server Reference

Source: `src/fetch/src/mcp_server_fetch/server.py`

Key implementation details:
- `extract_content_from_html()`: Uses `readabilipy.simple_json_from_html_string(html, use_readability=True)` → `markdownify.markdownify(content, heading_style=ATX)`
- `fetch_url()`: Uses `httpx.AsyncClient` with 30s timeout, follows redirects, checks content type
- Truncation: `content[start_index : start_index + max_length]`, appends `<error>Content truncated. Call fetch with start_index={N}</error>`
- Default max_length: 5000 chars
- Detects HTML via: `"<html" in page_raw[:100]` or `"text/html" in content_type`

## Appendix B: Jina Reader API Reference

Source: `https://docs.jina.ai/`

Key design points:
- Endpoint: `POST https://r.jina.ai/` with `{ url }` body
- Return format options: `markdown`, `html`, `text`, `screenshot`
- Content extraction headers: `X-Target-Selector` (CSS), `X-Remove-Selector` (CSS)
- Timeout header: `X-Timeout`
- Engine options: `browser` (best quality), `direct` (speed), `cf-browser-rendering` (JS-heavy)
- Rate limit: 500 RPM free tier

## Appendix C: VS Code Copilot grep_search Reference

Parameters observed from the tool I use:
- `query` (string, required): The search pattern
- `isRegexp` (boolean): Whether pattern is regex
- `includePattern` (string): Glob pattern for file filtering
- `maxResults` (number): Maximum results
- `includeIgnoredFiles` (boolean): Include .gitignore'd files
- Returns: file path, line number, matched line snippet
- Case-insensitive by default
