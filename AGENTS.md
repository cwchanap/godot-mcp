# AGENTS.md - Guidelines for Agentic Coding

## Build, Lint, and Test Commands
- `npm install` - Install dependencies.
- `npm run build` - Compile TypeScript, run typecheck, and prepare build artifacts.
- `npm run typecheck` - Run TypeScript compiler checks without emitting files.
- `npm run test` - Run all tests with Vitest.
- `npm run test:watch` - Watch mode for tests.
- `vitest run src/specific.spec.ts` - Run a single test file.
- `npm run inspector` - Launch MCP Inspector for tool testing.
- `npm run watch` - Incremental TypeScript rebuilds.

## Code Style Guidelines
- Use TypeScript with strict settings; prefer named exports, avoid defaults except for CLI entry points.
- Indent with 2 spaces; wrap long argument lists one per line.
- Naming: Classes `PascalCase`, functions/variables `camelCase`, constants `SCREAMING_SNAKE_CASE`.
- Imports: Group by external libraries, then internal modules; use relative paths for internal imports.
- Formatting: Follow ESLint/Prettier if configured; ensure consistent line endings.
- Types: Use explicit types; leverage TypeScript inference; add JSDoc for complex functions.
- Error Handling: Use try-catch for async operations; throw custom errors with descriptive messages; log errors appropriately without exposing sensitive info.
- No comments unless asked; follow existing patterns in codebase.
