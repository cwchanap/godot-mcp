# Repository Guidelines

## Project Structure & Module Organization
- `src/` contains the TypeScript server: `godot-server.ts` orchestrates transport, `tool-handlers.ts` defines MCP tools, `operation-executor.ts` manages child Godot runs, and `godot-path.ts` resolves executables.
- `src/scripts/godot_operations.gd` is the Godot-side helper invoked by MCP tools; updates here must remain compatible with the executor API.
- `build/` holds compiled output after `npm run build`. Treat it as ephemeral and never hand-edit artifacts.
- `scripts/` stores build automation (`build.js` copies scripts and fixes permissions) and belongs under version control.
- `tilemap-test-project/` is the reference Godot sample for manual regression checks; keep assets lightweight and deterministic.
- `CLAUDE.md` tracks agent-facing guidance—sync any public tool or capability changes.

## Build, Test, and Development Commands
- `npm install` – install TypeScript, MCP SDK, and runtime dependencies.
- `npm run build` – compile to `build/`, chmod the CLI entry point, and copy `godot_operations.gd`.
- `npm run watch` – incremental TypeScript rebuilds during development.
- `npm run inspector` – launch the MCP Inspector against `build/index.js` for interactive tool smoke tests.
- `node build/index.js` (or `npx godot-mcp`) – run the server once built; combine with `GODOT_PATH=/path/to/godot` when not on PATH.

## Coding Style & Naming Conventions
- Use TypeScript with the project’s strict compiler settings; prefer named exports and avoid default exports unless wrapping CLI entry points.
- Indent with two spaces; wrap long argument lists one per line, mirroring existing files.
- Classes are `PascalCase`, functions and variables `camelCase`, top-level constants `SCREAMING_SNAKE_CASE`.
- Rely on TypeScript for type safety; add concise JSDoc when interop or configuration values need clarification.

## Testing Guidelines
- Automated tests are not yet in place; validate changes by exercising relevant MCP tools via the Inspector or CLI.
- Use `tilemap-test-project/` to confirm tilemap and tileset operations still behave as expected.
- When adding tests, colocate them near the feature (e.g., `src/<feature>.spec.ts`) and document the command in this guide.
- Record manual test notes in pull requests, especially Godot version, platform, and any environment variables required.

## Commit & Pull Request Guidelines
- Follow Conventional Commit prefixes (`feat:`, `fix:`, `chore:`) as used in recent history; scope tags are welcome (`feat: tileset`).
- Keep commits focused and buildable; run `npm run build` before pushing.
- Pull requests should outline motivation, summarize testing (commands + Godot version), and link issues when applicable.
- Include screenshots or logs for UI-affecting Godot behavior and note configuration changes such as `GODOT_PATH` defaults.

## Configuration Tips
- Set `GODOT_PATH` to a fully qualified Godot executable when auto-detection fails; use `strictPathValidation` when shipping sensitive flows.
- Toggle verbose diagnostics with `DEBUG=true` or `GODOT_DEBUG_MODE=true` to capture extra logs during local investigation.
- Keep platform-specific instructions in README up to date when adding new deployment scenarios or tool requirements.
