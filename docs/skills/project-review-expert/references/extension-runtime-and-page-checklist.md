# Extension Runtime And Page Checklist

Read this when reviewing changes around MV3, content scripts, host-page UI, or cross-context communication.

## 1. Background / Service Worker

- [ ] No critical runtime state lives only in top-level mutable globals.
- [ ] Event listeners are registered synchronously at module load.
- [ ] Background logic does not assume timers or long-lived in-memory caches survive service worker suspension.
- [ ] Async message handlers preserve the response channel correctly and do not silently drop replies.

## 2. Messaging And Contracts

- [ ] Request and response payloads are typed end-to-end. Avoid `any` at context boundaries.
- [ ] Message handlers validate inputs from less-trusted contexts.
- [ ] Changes in one side of the contract are reflected everywhere that consumes that contract.
- [ ] Error payloads remain usable by UI layers instead of collapsing into generic failures.

## 3. Content Scripts On Host Pages

- [ ] DOM writes avoid unsafe HTML injection.
- [ ] Event listeners do not leak across reinjection, page transitions, or detached UI elements.
- [ ] Logic survives nested scroll containers, SPA rerenders, and transient selection states.
- [ ] Overlay positioning updates are resilient to scroll, resize, and layout shifts.
- [ ] Host-page interaction handling does not assume ownership of all clicks, selections, or styles.

## 4. Extension Context Invalidation

- [ ] Calls into `chrome.runtime` or long-lived ports handle extension reload/update failure paths.
- [ ] Stale UI on the page degrades gracefully instead of spamming errors or leaving broken controls visible.

## 5. Manifest And Permission Changes

- [ ] New permissions or host patterns are necessary and least-privilege.
- [ ] `web_accessible_resources` exposure stays minimal.
- [ ] Any CSP-related change keeps bundled-code-only assumptions intact.
