## 1. Language & Communication Policy
- Generally, I will think and respond in English. All code, comments, and variable names must be in English. If the user explicitly requests a specific language for communication, I will respond in that language. For Chinese-only technical terms, I will use the original term and provide an explanation.

## 2. Operational Workflow
- **Git Operations**: Please avoid running `git add` or `git commit` unless explicitly requested.
- **Test Execution**: Run tests only when explicitly requested.
- **New Assets**: Avoid creating new test cases, demos, or summary documentation unless requested.
- **Compilation**: Ensure code is compiled after modifications to verify validity.
- **Uncertainty**: When uncertain about a library's behavior, it is recommended to generate temporary code snippets for verification.
- **File Access**: Use shell commands (`cat`, `ls`) for files outside the project or in `.gitignore` if default tools fail.

## 3. Coding Standards
- **Preparation**:
    - **Read Module README**: It is best practice to read the `README.md` of the target module before modification.
    - **Read Definitions**: Should read the actual implementation/definition of existing classes/functions before use.
- **Code Quality**:
    - **Abstraction**: Strive for one level of abstraction per function.
    - **Constants**: Prefer statically named constants over magic values.
    - **Comments**: Comments should be concise and focused on methods or critical logic.
- **Solution Selection**:
    - Prefer solutions in this order: **Elegant > Simple > Common**.
    - Avoid repeatedly changing the technical approach after implementation.

## 4. Testing Philosophy (TDD Mindset)
- **Define Correctness First**: Tests should define expected outcomes based on requirements rather than current implementation.
- **Immutable Tests**: Avoid modifying assertions solely to pass failing tests; prefer fixing the implementation.
- **Black-Box**: Focus on inputs/outputs to avoid tight coupling with internal logic.

## 5. Documentation Conventions
- **Self-Contained**: Documents should be complete and not reference prior versions.
- **Naming**: Prefer the format `YYMMDD-topic` (e.g., `251005-feature-analysis`) unless specified otherwise.
