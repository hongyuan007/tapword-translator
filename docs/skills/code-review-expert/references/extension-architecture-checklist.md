# Extension Architecture Checklist

## Error Handling

- **`chrome.runtime.lastError`**:
  - [ ] **Check it**: Always check `chrome.runtime.lastError` in callbacks of `chrome.*` APIs.
  - [ ] **Promise Rejections**: If using Promise wrappers (Vite/Polyfills), ensure `.catch()` is present.
- **Context Invalidation**:
  - [ ] **Extension Updates/Reloads**: Old content scripts become "orphaned" when the extension updates or reloads.
    - *Check*: Does the code handle "Extension context invalidated" errors?
    - *Fix*: Use a heartbeat mechanism or try-catch blocks around `sendMessage` to detect invalidation and stop execution gracefully.

## Code Organization

- **Shared Code**:
  - [ ] **Utils**: Are utilities (like Loggers) compatible with both Window (Content/Popup) and Worker (Background) contexts?
- **Types**:
  - [ ] **Message Protocol**: strict typing for message passing (Request/Response types). No `any` in payloads.

## Messaging (Critical)

- **Async Responses**:
  - [ ] **Return `true`**: In `runtime.onMessage` listeners, if you call `sendResponse` asynchronously (e.g., after an `await`), you **MUST** `return true;` synchronously at the end of the listener. Failing to do so will close the message port immediately.

## UX Patterns

- **UI Blocking**:
  - [ ] **Async Operations**: Popup UI should show loading states for background operations.
- **The "Missing" State**:
  - [ ] **Data Availability**: Do not assume `storage.get` returns data immediately. Handle `undefined` / `loading` states gracefully.
  - [ ] **Race Conditions**: Avoid logic that relies on strict ordering of async events (e.g., read-modify-write without locking or atomic operations).
- **Offline Support**:
  - [ ] **Network Failures**: Handle offline state gracefully (e.g., translation request fails).

## Manifest

- **Version**: Ensure version is bumped if releasing.
- **Icons**: Ensure all sizes (16, 48, 128) are provided.
- **Locales**: If `default_locale` is set, ensure `_locales` directory structure is correct.
