# m07: Extension UI Exclusion from Full-Text Translation

## Goal
Prevent the extension's own injected DOM elements (floating button, tooltips, modals, icons, toasts) from being picked up by the full-text translation walker.

## Status: DONE

## Tasks
- [x] Research current walker skip logic and all UI injection points
- [x] Create spec document
- [x] Implement unified `data-tapword-ext` attribute
- [x] Verify with type-check
