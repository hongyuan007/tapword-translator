# TapWord Translator

A smart AI-powered translation browser extension that provides context-aware translations for selected text on web pages.

## ✨ Features

- **Smart Trigger**: A subtle icon appears next to selected text, waiting for your click.
- **Context-Aware Translation**: By analyzing the surrounding text, the AI delivers highly accurate and relevant translations, far beyond simple word-for-word equivalents.
- **AI-Powered**: Leverages the power of Large Language Models (LLMs) like GPT and Gemini for superior translation quality.
- **Floating Notes Display**: Translations are displayed in an unobtrusive floating card directly below the highlighted text.
- **Persistent Annotations**: All translations remain on the page as you scroll, creating a temporary "annotated" version of the site for easy reference.

##  Folder Structure

```
.
├── dist/                   # Build output (loaded into Chrome)
├── resources/              # Static assets (icons, etc.)
├── src/                    # Source code
│   ├── 0_common/           # Shared utilities, types, and constants
│   ├── 1_content/          # Content scripts injected into web pages
│   ├── 2_background/       # Background service worker
│   ├── 3_popup/            # Extension popup UI
│   ├── 4_options/          # Extension options/settings page
│   ├── 5_backend/          # Generic API infrastructure (service, types)
│   ├── 6_translate/        # Translation business logic
│   ├── 7_speech/           # Speech synthesis module
│   ├── 8_generate/         # Text generation module
│   ├── 14_inline_translate/ # Inline translation module
│   ├── 9_offscreen/        # Offscreen document for background tasks
│   ├── 10_welcome/         # Welcome/onboarding page
│   ├── 11_full_translate/  # Full-page translation module
│   ├── 12_floating_button/ # Floating ball button module
│   └── 13_sidepanel/       # AI chat assistant side panel
├── test/                   # Unit and integration tests
├── package.json            # NPM package configuration
├── tsconfig.json           # TypeScript configuration
└── vite.config.ts          # Vite build configuration
```

## Sub-Module Documentation
**Mandatory Reading**: Before working on any file within a sub-module, you MUST read its corresponding README document first, to understand its architecture and coding conventions.

- `src/0_common/README.md`
- `src/1_content/README.md`
- `src/2_background/README.md`
- `src/3_popup/README.md`
- `src/4_options/README.md`
- `src/5_backend/README.md`
- `src/6_translate/README.md`
- `src/7_speech/README.md`
- `src/8_generate/README.md`
- `src/14_inline_translate/README.md`
- `src/9_offscreen/README.md`
- `src/11_full_translate/README.md`
- `src/12_floating_button/README.md`
- `src/13_sidepanel/README.md`

## Technical Stack

### Core Technologies
- **TypeScript**: For static typing and modern JavaScript features.
- **Vite**: As the build tool for development and production.
- **Vitest**: For running unit and integration tests.

### Key Configuration Files
- `package.json`: Defines project scripts, dependencies, and metadata.
- `vite.config.ts`: Configures the Vite build process, including plugins and build targets.
- `tsconfig.json`: Specifies TypeScript compiler options and project files.
- `manifest.json`: The extension manifest file for Chrome.

### Common Commands
- `npm run dev`: Starts the development build with watch mode.
- `npm run build`: Creates a production-ready build.
- `npm run dev:community`: Starts the community build with watch mode.
- `npm run build:community`: Creates a community-ready build.
- `npm test -- run <test-file>`: Run a specific test file.
- `npm run type-check`: Checks for TypeScript type errors without compiling.


## Project Coding Conventions

### Import Style
- **Absolute Paths**: Always use the `@/` prefix (maps to `src/`) for imports instead of relative paths (`../`).
- **Namespace Imports**: Use namespace imports (`import * as name from '...'`) for functions and variables to make their origin explicit. This is preferred over named imports for clarity.

```typescript
// ✅ Correct
import * as loggerModule from '@/0_common/utils/logger';
const logger = loggerModule.createLogger('my-module');

// ❌ Avoid (Relative Path and Named Import)
import { createLogger } from '../../0_common/utils/logger';
const logger = createLogger('my-module');
```

### Module Index Files
- **Explicit exports only**: Module `index.ts` files must explicitly list all exported members, never use `export *`
- **Categorized exports**: Group exports by type (classes, functions, types) with clear comments
- **Type annotations**: Use `export type` for type-only exports to enable proper tree-shaking
```typescript
// ✅ Correct - Explicit exports with categories
export type { TranslationApiData, TranslateParams } from './models/TranslationModels';
export { translate, translateWord } from './services/TranslationService';

// ❌ Avoid - Wildcard exports
export * from './models/TranslationModels';
```

### Logging
- **Use logger utility**: Replace `console.log/error` with `createLogger()` for consistent prefixes
```typescript
// ✅ Correct
import { createLogger } from '@/0_common/utils/logger';
const logger = createLogger('className/ModuleName/functionName');
logger.info('Message');

// ❌ Avoid
console.log('[ModuleName] Message');
```

## Public Interface Declarations
- **Explicit Interface at Top**: Every service, store, or manager file must declare an `interface I{Name}` at the top of the file listing all public methods.
- **Class + Interface Pattern**: Service, Store, and Manager files MUST use a class-based pattern. The class must `implements I{Name}`.
- **Singleton Export**: For stateless or module-scoped service classes, better export a singleton instance: `export const myService = new MyService()`.
- **API Contract**: The interface serves as the public API contract that consumers depend on.

### In-App UI Localization
The project uses a custom utility at `src/0_common/utils/i18n.ts` for in-app UI translations.

- **HTML**: Add `data-i18n-key="key.name"` to elements. `applyTranslations()` will handle the rest.
- **TypeScript**: Import with `import * as i18nModule from "@/0_common/utils/i18n"`, then use `i18nModule.translate('key.name')` for dynamic strings.

### Architecture Principles
- **Infrastructure Purity**: Infrastructure code MUST be agnostic of business logic and environment state.
- **Inject, Don't Fetch**: Pass configuration via arguments (Dependency Injection). NEVER import business logic or state managers into infrastructure layers.

## Automated E2E Testing (Playwright)

Use Playwright to verify extension functionality in a real browser environment. 

**For detailed instructions on running, writing, and debugging E2E tests, AI agents MUST refer to the dedicated skill document:**
`docs/skills/e2e-testing/SKILL.md`
