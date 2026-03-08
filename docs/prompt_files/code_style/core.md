# Project Coding Standards

All subagents MUST strictly adhere to these rules when writing or modifying code.

## 1. Language and Style
- **Language**: All code, comments, and variable names MUST be in English.
- **Clean Code**: Each function should have exactly one level of abstraction.
- **Comments**: Only comment at methods and critical code blocks. Keep them concise and clear.
- **Naming**: Avoid magic/literal values; use statically named constants instead.

## 2. Imports and Organization
- **Absolute Paths**: Always use the `@/` prefix (mapping to `src/`) for imports. NEVER use relative paths (e.g., `../`).
- **Namespace Imports**: Prefer `import * as name from '...'` for functions and variables to make their origin explicit.
- **Module Index Files**:
    - Use explicit exports only (never `export *`).
    - Categorize exports by type (classes, functions, types).
    - Use `export type` for type-only exports.
- **File Structure**: Export public functions/variables at the top of the file; keep internal functions below.

## 3. Architecture and Logic
- **Infrastructure Purity**: Infrastructure code must be agnostic of business logic and environment state.
- **Dependency Injection**: Pass configuration via arguments. NEVER import business logic or state managers into infrastructure layers.
- **Read Before Use**: Always read the implementation or definition of a class/function before using it.
- **Module Context**: Read the README of a module before modifying any code within it.

## 4. Logging and Errors
- **Logger Utility**: Use `@/0_common/utils/logger` instead of `console.log/error`.
    - Usage: `const logger = loggerModule.createLogger('ModuleName/functionName');`
- **Error Handling**: Use the project's standard error patterns (check existing implementations in the same module).

## 5. Testing (TDD Mindset)
- **Black-Box Testing**: Focus on inputs and outputs without considering internal logic.
- **Correctness First**: Define expected outcomes based on requirements, not the current implementation.
