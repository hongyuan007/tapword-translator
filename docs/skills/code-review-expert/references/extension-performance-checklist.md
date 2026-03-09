# Extension Performance Checklist

## Storage & Quotas

- **`chrome.storage.sync`**:
  - [ ] **Quota Limits**: 100KB total, 8KB per item. Exceeding this throws errors.
    - *Check*: Are we storing large JSON blobs in sync?
    - *Fix*: Use `chrome.storage.local` for large data, `sync` only for settings.
  - [ ] **Write Frequency**: MAX_WRITE_OPERATIONS_PER_HOUR (1800) / PER_MINUTE (120).
    - *Check*: Are we writing to storage on every keystroke or scroll event?
    - *Fix*: Debounce writes.

## Content Scripts

- **Injection Timing**:
  - [ ] **`run_at`**: Use `document_idle` (default) preferred to avoid slowing down initial page load.
  - [ ] **Size**: Keep content scripts small. Large bundles delay page interactivity.
- **DOM Manipulation**:
  - [ ] **Layout Thrashing**: Avoid read-then-write loops on DOM properties (e.g., `offsetHeight`).
  - [ ] **MutationObservers**: Ensure observers disconnect or are scoped narrowly to avoid performance hits on complex pages.

## Background Service Worker

- **Startup Time**:
  - [ ] **Cold Start**: Service workers stop after inactivity. Minimize initialization work.
  - [ ] **Keep-Alive**: Don't use hacks to keep SW alive indefinitely (drains battery/memory). Design for event-driven wakeups.

## Memory

- **Event Listeners**:
  - [ ] **Cleanup**: Remove `window` or `document` listeners in Content Scripts when elements are removed or extension is disabled (listen to `runtime.onSuspend` if applicable, though tricky in content scripts).
- **Data Structures**:
  - [ ] **Unbounded Caches**: Check specifically for arrays/objects in `storage` that grow indefinitely without a cap.
