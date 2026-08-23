# Cross-Agent Distribution Design

## Goal

Make the existing `@cwchanap/godot-plugin` MCP server easy to use from Codex, Claude Code, Cursor, Devin, OpenCode, and Pi without creating client-specific MCP implementations.

## Architecture

Keep `@cwchanap/godot-plugin` as the only runtime artifact. Every integration ultimately launches the same stdio MCP command:

```text
npx -y @cwchanap/godot-plugin@0.1.4
```

The repository adds only distribution metadata around that runtime:

- Agent Plugins 1.0 metadata at the repository/package root for portable clients such as Cursor;
- the existing Codex marketplace wrapper;
- a thin Claude Code marketplace wrapper that reuses the existing nested `.mcp.json`;
- documented direct MCP configuration for Devin and OpenCode;
- documented community adapters for Pi.

No manifest generator is introduced. The JSON files are small and explicit; `src/plugin-packaging.spec.ts` enforces version and launcher parity.

## Distribution Layout

```text
plugin.json                         # Agent Plugins 1.0 manifest
mcp.json                            # Agent Plugins 1.0 MCP definition
.agents/plugins/marketplace.json    # existing Codex marketplace
.claude-plugin/marketplace.json     # Claude Code marketplace
plugins/godot-plugin/
  .mcp.json                         # shared Codex/Claude stdio launcher
  .codex-plugin/plugin.json         # existing Codex manifest
  .claude-plugin/plugin.json        # Claude Code manifest
README.md                           # client setup and project documentation
```

The root `mcp.json` and nested `.mcp.json` use the same `godot` server key and launch command. The portable file additionally declares the Agent Plugins 1.0 MCP schema.

## Release Strategy

This PR is distribution-only, not an npm release. Keep the already-published runtime at `0.1.4` and leave `package-lock.json`, `GODOT_SERVER_INFO`, the Codex manifest, and the existing nested MCP launcher unchanged.

All new metadata pins `@cwchanap/godot-plugin@0.1.4`, so it works with the current published package immediately. `package.json.files` adds `plugin.json` and `mcp.json` so the portable metadata is included automatically in the next normal npm release. A future release can bump package and manifest versions together using the existing release workflow.

## Client Support

### Codex

Keep the existing repository marketplace and Codex plugin wrapper unchanged.

### Claude Code

Add `.claude-plugin/marketplace.json` at repository root and `.claude-plugin/plugin.json` inside `plugins/godot-plugin`. The Claude manifest points `mcpServers` at `./.mcp.json`, reusing the native wrapper MCP configuration rather than defining a Claude-specific server.

### Cursor

Use the root Agent Plugins 1.0 `plugin.json` and `mcp.json`. Do not add a Cursor-specific manifest because there are no Cursor-only components.

### Devin

Document a custom STDIO MCP connection using the current package. Add no Devin-specific source file.

### OpenCode

Document the stable local MCP configuration. Add no OpenCode JavaScript/TypeScript plugin because MCP already covers the required integration.

### Pi

Document `pi-mcp-adapter` as the MCP route and `pi-agent-plugins` as the optional Agent Plugins 1.0 route. Both are community-maintained; add no Pi-specific extension code.

## Packaging Contract

Extend `src/plugin-packaging.spec.ts` to verify:

- npm identity remains `@cwchanap/godot-plugin@0.1.4`;
- `package.json.files` includes `build`, `plugin.json`, and `mcp.json`;
- root Agent Plugins schemas are exactly version `1.0.0`;
- portable and nested MCP launchers use server key `godot`, `npx`, `-y`, and the same pinned npm package version;
- Codex and Claude manifests match the npm version and resolve the existing `.mcp.json`;
- the Claude marketplace points to `./plugins/godot-plugin`;
- distributable manifest JSON contains no absolute filesystem paths.

The existing packed CLI smoke test remains unchanged because it already verifies the installed executable, MCP handshake metadata, and tool discovery.

## Documentation

Keep detailed client setup directly in the README Quick Start section so users have one obvious setup guide. Include the support level and copy/paste configuration for Codex, Claude Code, Cursor, Devin, OpenCode, and Pi, plus the existing Cline and generic MCP instructions. Preserve the hosted-Devin locality limitation and Pi's community-maintained/trust warning.

## Non-Goals

- No npm version bump, publication, or GitHub release.
- No MCP runtime or Godot tool behavior changes.
- No separate MCP server per agent.
- No hosted or HTTP MCP transport.
- No relay from hosted agents to a user's local Godot process.
- No custom OpenCode plugin or Pi extension.
- No Cursor-specific plugin manifest.
- No MCP SDK upgrade.
- No tool splitting or tool-profile system.

## Verification

Implementation is complete when:

1. the packaging contract is proven RED against the old layout;
2. the final branch passes typecheck, build, packed CLI smoke, and all unit tests;
3. the PR diff contains only distribution metadata, package-file inclusion, tests, README/documentation, and this design/plan pair;
4. the PR stays draft and performs no release or merge action.
