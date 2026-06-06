# Repo Conventions Checklist

Use this checklist when the diff touches shared code, exported APIs, logging, or general TypeScript structure.

## Imports And Exports

- [ ] Prefer `@/` absolute imports over relative traversal imports.
- [ ] Prefer namespace imports for functions and variables.
- [ ] `index.ts` files use explicit exports only; no `export *`.
- [ ] Type-only exports use `export type`.

## Logging And Errors

- [ ] Use `createLogger()` instead of `console.log` or `console.error`.
- [ ] Error handling preserves actionable context instead of swallowing failures silently.

## Comments And Naming

- [ ] Comments exist only where the control flow or intent is not obvious.
- [ ] Function names match what they actually do.
- [ ] Stable behavior values are promoted to named constants instead of repeated literals.

## Localization And UI Text

- [ ] In-app UI strings go through the repository i18n utility when appropriate.
- [ ] New keys and usage stay consistent with existing localization patterns.

## Review Smells

- [ ] Duplicated helpers that should have reused an existing module
- [ ] Business logic creeping into infrastructure helpers
- [ ] Hidden coupling created by importing deep internals instead of public exports
