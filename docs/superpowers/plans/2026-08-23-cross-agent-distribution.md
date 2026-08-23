# Cross-Agent Distribution Implementation Plan

> **For agentic workers:** Use the Superpowers execution workflow and keep this task in one PR.

**Goal:** Make the existing Godot MCP runtime consumable by Codex, Claude Code, Cursor, Devin, OpenCode, and Pi with minimal client-specific metadata.

**Architecture:** Keep `@cwchanap/godot-plugin@0.1.4` as the only runtime. Add Agent Plugins 1.0 metadata and a thin Claude Code wrapper; use direct MCP configuration for clients that already support stdio MCP. Do not couple this distribution task to an npm release.

**Spec:** `docs/superpowers/specs/2026-08-23-cross-agent-distribution-design.md`

## Constraints

- One PR: `feat/cross-agent-distribution` / PR #4.
- Keep package/runtime version `0.1.4` in this PR.
- Keep `GODOT_SERVER_INFO`, `package-lock.json`, Codex wrapper behavior, and all MCP/Godot tool code unchanged.
- All launchers use server key `godot` and `npx -y @cwchanap/godot-plugin@0.1.4`.
- Agent Plugins metadata targets specification `1.0.0`.
- No Cursor-specific manifest, Devin wrapper, OpenCode plugin, Pi extension, HTTP transport, relay, SDK upgrade, publication, or merge.

## Task 1: Define the cross-agent packaging contract

**File:** `src/plugin-packaging.spec.ts`

- [x] Add assertions for root Agent Plugins `plugin.json` and `mcp.json`.
- [x] Add assertions for the Claude Code wrapper and marketplace.
- [x] Require portable and nested MCP launchers to stay equivalent.
- [x] Require npm package contents to include the portable manifests.
- [x] Extend absolute-path hygiene across every distributable manifest.
- [x] Commit the test before implementation and confirm RED in CI.

**RED evidence:** PR CI run `32625897258` passed Build & Lint, then Unit Tests failed exactly six new packaging assertions while 116 existing tests passed and two integration tests remained skipped.

## Task 2: Add portable and Claude distribution metadata

**Create:**

- `plugin.json`
- `mcp.json`
- `.claude-plugin/marketplace.json`
- `plugins/godot-plugin/.claude-plugin/plugin.json`

**Modify:**

- `package.json`

- [x] Add Agent Plugins 1.0 root manifest with package version `0.1.4`.
- [x] Add Agent Plugins 1.0 root MCP manifest launching `npx -y @cwchanap/godot-plugin@0.1.4`.
- [x] Add Claude Code marketplace metadata pointing to `./plugins/godot-plugin`.
- [x] Add Claude Code plugin metadata that reuses `./.mcp.json`.
- [x] Add `plugin.json` and `mcp.json` to `package.json.files` for the next npm release.
- [x] Leave package version, lockfile, server runtime metadata, and existing Codex launcher at `0.1.4`.

## Task 3: Document the requested clients

**Modify:** `README.md`

- [x] Document the shared version-pinned stdio launcher and support matrix.
- [x] Document existing Codex marketplace installation.
- [x] Document Claude Code marketplace installation and direct MCP fallback.
- [x] Document Cursor Agent Plugins 1.0 local loading and native MCP fallback.
- [x] Document Devin custom STDIO MCP fields and hosted-environment limitation.
- [x] Document stable OpenCode local MCP configuration and note the separate V2 shape.
- [x] Document Pi through community `pi-mcp-adapter` and optional `pi-agent-plugins`, including the trust warning.
- [x] Preserve Cline and generic MCP configuration in the same Quick Start section.
- [x] Remove the separate `AGENT-INTEGRATIONS.md` file so README is the single user-facing setup guide.

## Task 4: Final verification and review

- [x] Confirm PR CI passes Build & Lint and Unit Tests.
- [x] Confirm packed CLI smoke reports `godot-mcp` version `0.1.4` with 32 discovered tools.
- [x] Confirm unit tests report 123 passed and 2 environment-gated integration tests skipped after the CodeRabbit fixes.
- [x] Review the final PR diff for accidental runtime, dependency, lockfile, or tool-behavior changes.
- [x] Confirm `package.json.files` is the only existing package-runtime file changed.
- [x] Keep PR #4 draft; do not merge or publish.

**GREEN evidence:** PR CI run `32656081316` completed Build & Lint and Unit Tests successfully after the CodeRabbit fixes. Vitest reported 123 passed and 2 skipped tests, and npm publishing was skipped. README consolidation is verified by the subsequent PR CI run before completion.
