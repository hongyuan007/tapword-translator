# Manifest V3 (MV3) Compliance Checklist

## Service Worker (Background)

- **Ephemeral Nature**: 
  - [ ] **NO Global State**: Are variables outside functions used to store state? They will be reset when the SW terminates.
    - *Fix*: Use `chrome.storage.local` or `chrome.storage.session` for state persistence.
  - [ ] **Event Listeners**: Are listeners registered synchronously at the top level?
    - *Bad*: Registering listeners inside `async` functions or `setTimeout`.
    - *Good*: `chrome.runtime.onMessage.addListener(...)` at root scope.
- **Timers**:
  - [ ] **No `setInterval`**: `setInterval` fails when the SW goes inactive (approx 30s).
    - *Fix*: Use `chrome.alarms` API for periodic tasks.
  - [ ] **No long `setTimeout`**: Similar issues. Use alarms or handle logically.
- **DOM Access**:
  - [ ] **No DOM APIs**: `window`, `document` are not available in Service Workers.
    - *Fix*: Use `Offscreen Documents` for DOM parsing or canvas operations.
  - [ ] **No `XMLHttpRequest`**: Use `fetch` API exclusively.

## Content Security Policy (CSP)

- **Remotely Hosted Code**:
  - [ ] **Strict Ban**: No loading scripts from external CDNs (`<script src="https://...">`). All code must be bundled.
- **Eval**:
  - [ ] **No `eval()`**: `eval()` and `new Function()` are blocked by default and highly discouraged.
- **WASM**:
  - [ ] specific CSP rules required for WASM.

## Web Accessible Resources

- [ ] **Minimize Exposure**: Are resources in `web_accessible_resources` kept to a minimum?
- [ ] **Specific Matches**: Use specific `matches` patterns instead of `<all_urls>` where possible.

## Cross-Origin Requests

- [ ] **Host Permissions**: Requests to cross-origin servers from Content Scripts are blocked by CORB/CORS.
    - *Fix*: Proxy requests through the Background Service Worker if needed.
