# Godot Plugin Packaging Design

**Status:** Approved in chat on 2026-08-21

## Context

The repository currently builds a local stdio MCP server from `build/index.js` and publishes under the inherited `@coding-solo/godot-mcp` identity. The new distribution must be owned by `cwchanap`, installable by Codex as a plugin, and independent of the upstream creator's npm namespace.

The GitHub repository and local checkout remain named `godot-mcp` for now. Renaming either is explicitly outside this change.

## Goals

- Publish the server as `@cwchanap/godot-plugin`.
- Package it as an installable Codex plugin named `godot-plugin`.
- Provide a repo-local marketplace for development and team installation.
- Preserve the MCP server key `godot` so installed tools retain the `mcp__godot__*` namespace.
- Keep the plugin portable across supported operating systems without hardcoded Godot paths.
- Preserve the existing MIT license and upstream attribution.

## Non-goals

- Renaming `cwchanap/godot-mcp` or the local `godot-mcp` checkout.
- Publishing to npm without a separate explicit approval.
- Adding a plugin skill, hosted MCP server, authentication layer, or plugin UI.
- Changing existing MCP tools or runtime behavior.

## Package identity

The npm package becomes `@cwchanap/godot-plugin` and starts at version `0.1.0`. Its executable is named `godot-plugin` and continues to launch `build/index.js`.

The repository URL remains `https://github.com/cwchanap/godot-mcp`. The package and plugin metadata identify `cwchanap` as the publisher while retaining upstream attribution in the license and README.

## Plugin structure

The repository gains these files:

```text
.agents/plugins/marketplace.json
plugins/godot-plugin/
├── .codex-plugin/
│   └── plugin.json
└── .mcp.json
```

The plugin manifest uses:

- name `godot-plugin`;
- version `0.1.0`;
- publisher/developer identity `cwchanap`;
- category `Developer Tools`;
- `mcpServers` path `./.mcp.json`;
- the existing repository and MIT license metadata;
- concise default prompts for inspecting and running Godot projects.

The manifest does not declare skills, apps, hooks, icons, screenshots, privacy URLs, or terms URLs because this release does not provide those resources.

The repo marketplace is named `cwchanap`, displays `cwchanap`, and exposes `godot-plugin` from `./plugins/godot-plugin` with installation `AVAILABLE`, authentication `ON_INSTALL`, and category `Developer Tools`.

## MCP launch flow

The plugin-local `.mcp.json` declares one stdio server named `godot`:

```text
Codex plugin install
  -> plugin .mcp.json
  -> npx -y @cwchanap/godot-plugin@0.1.0
  -> build/index.js
  -> Godot executable discovery
  -> mcp__godot__* tools
```

The committed configuration pins the package version rather than using `latest`, keeping plugin installs reproducible. Package and plugin versions advance together.

No local absolute path is committed. The server uses its existing Godot discovery behavior and accepts `GODOT_PATH` when automatic discovery is insufficient.

## Documentation

The README will add Codex plugin installation and troubleshooting instructions. It will describe:

- installing the repo marketplace and `godot-plugin`;
- starting a new Codex task after installation;
- using `GODOT_PATH` for nonstandard installations;
- the `@cwchanap/godot-plugin` npm package;
- upstream lineage and retained MIT attribution.

Existing client documentation may continue to describe the inherited package until the new package is published. The Codex section must not claim the new npm package is available before publication succeeds.

## Error handling

- If npm or the network is unavailable when `npx` first resolves the package, Codex reports an MCP startup failure. Documentation directs users to verify npm connectivity and retry.
- If Godot cannot be discovered, the existing server error remains authoritative. Documentation directs users to configure `GODOT_PATH`.
- If package, plugin, or marketplace versions diverge, an automated contract test fails before release.
- No credentials, API keys, or machine-specific paths are stored in plugin metadata.

## Verification

### Before publication

1. Run the existing TypeScript typecheck, build, and full Vitest suite.
2. Validate `plugins/godot-plugin` with the Codex plugin validator.
3. Run an automated contract test that checks:
   - npm package name and version;
   - executable name and target;
   - plugin name and version;
   - `.mcp.json` package pin and server key;
   - marketplace name, source path, policy, and category.
4. Run `npm pack --dry-run` and inspect the package contents.
5. Build a package tarball and smoke-test the MCP server from that artifact without publishing it.

### Publication gate

Publishing `@cwchanap/godot-plugin@0.1.0` is an external change and requires explicit user approval. The package must be public and published with the intended npm account.

### After publication

1. Install the repository marketplace in Codex.
2. Install `godot-plugin@cwchanap`.
3. Start a new Codex task so plugin tools are loaded.
4. Call `get_godot_version`.
5. Call `get_project_info` against a real Godot project.
6. Confirm the tools are exposed under the `mcp__godot__*` namespace.

## Compatibility

Existing local Codex configurations that invoke `/Users/chanwaichan/workspace/godot-mcp/build/index.js` remain valid because this change does not rename the checkout or remove the current entrypoint. The new npm identity does not overwrite or impersonate `@coding-solo/godot-mcp`.

The initial plugin release intentionally avoids a compatibility executable alias. The new package has no established consumers, so `godot-plugin` is the only executable name.
