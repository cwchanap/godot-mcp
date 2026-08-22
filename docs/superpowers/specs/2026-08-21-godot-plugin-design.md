# Godot Plugin Packaging Design

**Status:** Amended after review; awaiting user approval

## Context

The repository builds a local stdio MCP server from `build/index.js` and currently publishes under the inherited `@coding-solo/godot-mcp` identity. The new distribution must be owned by `cwchanap`, installable by Codex as a plugin, and independent of the upstream creator's npm namespace.

The GitHub repository is `cwchanap/godot-agent-plugin`; the local checkout remains named `godot-mcp`.

## Goals

- Publish the server as `@cwchanap/godot-plugin`.
- Package it as an installable Codex plugin named `godot-plugin`.
- Provide a repo-local marketplace for installing the published server.
- Preserve the MCP server key `godot` so installed tools retain the `mcp__godot__*` namespace.
- Keep the plugin portable across supported operating systems without hardcoded Godot paths.
- Preserve the existing MIT license and Solomon Elias's copyright notice.

## Non-goals

- Renaming the local `godot-mcp` checkout.
- Publishing to npm without a separate explicit approval.
- Using the repo marketplace as a second local-development MCP launcher.
- Adding a plugin skill, hosted MCP server, authentication layer, or plugin UI.
- Changing existing MCP tools or runtime behavior.
- Adding a `godot-mcp` executable alias to the new package.
- Replacing or impersonating `@coding-solo/godot-mcp`.

## Version contract

The first `@cwchanap/godot-plugin` release keeps version `0.1.4`, matching the current package, MCP initialization metadata, generated runtime bridge, and compatibility tests.

The version is a runtime compatibility token, not only npm metadata. `scripts/build.js` stamps the package version into the generated runtime bridge, and the server requires exact equality during the runtime handshake. Resetting the package to `0.1.0` would make existing `0.1.4` bridges incompatible while the server still reported `0.1.4`.

One contract test locks these version-bearing surfaces together:

- `package.json` version;
- `GodotServer` initialization version;
- plugin manifest version;
- `.mcp.json` npm package pin.

Future releases update all four values together. The marketplace entry has no version field.

## Package identity

The npm artifact is a cross-client MCP server even though its new package name is `@cwchanap/godot-plugin`. This name is an explicit publisher decision. The Codex wrapper is also named `godot-plugin`, while the MCP protocol identity remains `godot-mcp` and the plugin's MCP server key remains `godot`.

The publishable `package.json` identity is:

| Field | Value |
| --- | --- |
| `name` | `@cwchanap/godot-plugin` |
| `version` | `0.1.4` |
| `author` | `cwchanap` |
| `homepage` | `https://github.com/cwchanap/godot-agent-plugin` |
| `bugs.url` | `https://github.com/cwchanap/godot-agent-plugin/issues` |
| `repository.url` | `git+https://github.com/cwchanap/godot-agent-plugin.git` |
| `publishConfig.access` | `public` |
| executable | `godot-plugin` -> `build/index.js` |
| published files | `build/` only |

The package description and keywords continue to describe a general Godot MCP server rather than a Codex-only integration. The MIT license retains `Copyright (c) 2025 Solomon Elias`; the README adds fork/publisher attribution without replacing that notice.

## Plugin structure

The repository gains these files:

```text
.agents/plugins/marketplace.json
plugins/godot-plugin/
├── .codex-plugin/
│   └── plugin.json
└── .mcp.json
```

The complete plugin manifest is:

```json
{
  "name": "godot-plugin",
  "version": "0.1.4",
  "description": "Connect Codex to local Godot projects through the Godot MCP server.",
  "author": {
    "name": "cwchanap",
    "url": "https://github.com/cwchanap"
  },
  "homepage": "https://github.com/cwchanap/godot-agent-plugin",
  "repository": "https://github.com/cwchanap/godot-agent-plugin",
  "license": "MIT",
  "keywords": ["godot", "mcp", "codex", "game-development"],
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "Godot Plugin",
    "shortDescription": "Inspect, run, and control local Godot projects.",
    "longDescription": "Connect Codex to the local Godot editor and runtime for project inspection, scene operations, execution, logs, and runtime controls.",
    "developerName": "cwchanap",
    "category": "Developer Tools",
    "capabilities": ["Read", "Write"],
    "websiteURL": "https://github.com/cwchanap/godot-agent-plugin",
    "defaultPrompt": [
      "Inspect this Godot project and summarize its structure.",
      "Run this Godot project and diagnose any errors.",
      "Use Godot tools to implement and verify this change."
    ]
  }
}
```

The manifest intentionally omits skills, apps, hooks, icons, screenshots, privacy URLs, and terms URLs because this release does not provide those resources.

The plugin-local MCP configuration is:

```json
{
  "mcpServers": {
    "godot": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cwchanap/godot-plugin@0.1.4"]
    }
  }
}
```

The repo marketplace is named `cwchanap`, displays `cwchanap`, and exposes `godot-plugin` from `./plugins/godot-plugin` with installation `AVAILABLE`, authentication `ON_INSTALL`, and category `Developer Tools`. `ON_INSTALL` is the standard plugin-creator default; there is no product-gating override.

## Launch paths

Published plugin use follows one launch path:

```text
Codex installs godot-plugin@cwchanap
  -> plugin .mcp.json
  -> npx -y @cwchanap/godot-plugin@0.1.4
  -> build/index.js
  -> Godot executable discovery
  -> mcp__godot__* tools
```

The npm package version is pinned rather than using `latest`, keeping installs reproducible.

Local development remains unchanged:

```text
.codex/config.toml
  -> node /Users/chanwaichan/workspace/godot-mcp/build/index.js
```

The repo marketplace is not a pre-publication development launcher. Before npm publication it can be validated structurally, but its MCP process cannot start because the pinned package does not exist yet. No second `.mcp.json`, copied `build/`, or local-path launcher is added.

No absolute Godot executable path is committed. The server uses its existing discovery behavior and accepts `GODOT_PATH` when automatic discovery is insufficient.

## Documentation

The same change updates identity and usage documentation:

- `package.json` receives the complete npm identity table and public publish configuration.
- `CLAUDE.md` replaces the inherited packaged command with `npx @cwchanap/godot-plugin` and labels it unavailable until publication.
- `README.md` adds Codex marketplace installation, `GODOT_PATH` troubleshooting, the new npm identity, and upstream attribution.
- Existing Claude, Cline, Cursor, and generic MCP examples remain on `@coding-solo/godot-mcp` until `@cwchanap/godot-plugin` is actually published.
- Documentation must not claim that the new npm package or plugin launch path works before publication succeeds.

## Error handling

- Before publication, the committed plugin wrapper is structurally valid but cannot launch its npm pin. This is an explicit release gate, not a fallback condition.
- If npm or the network is unavailable when `npx` first resolves a published package, Codex reports an MCP startup failure. Documentation directs users to verify npm connectivity and retry.
- If Godot cannot be discovered, the existing server error remains authoritative. Documentation directs users to configure `GODOT_PATH`.
- If identity or version fields diverge, the Vitest contract test fails before release.
- No credentials, API keys, absolute Godot paths, or local checkout paths are stored in the distributable plugin files.

## Verification

### Automated contract test

A new Vitest file reads `package.json`, `plugins/godot-plugin/.codex-plugin/plugin.json`, `plugins/godot-plugin/.mcp.json`, and `.agents/plugins/marketplace.json`. It asserts:

- the package identity table, including `publishConfig.access`;
- package version equality with `GodotServer` metadata and the plugin manifest;
- executable name and target;
- plugin name, required interface metadata, capabilities, and default prompts;
- MCP server key `godot` and exact npm package pin;
- marketplace name, source path, installation policy, authentication policy, and category;
- absence of absolute paths from the distributable plugin JSON files.

This test extends the existing Vitest suite. The external Codex validator remains a manual pre-publication check and is not copied into this repository.

### Before publication

1. Run the existing TypeScript typecheck, build, and full Vitest suite.
2. Run the external Codex plugin validator against `plugins/godot-plugin`.
3. Run `npm pack --dry-run` with a writable temporary npm cache.
4. Confirm the npm artifact contains `build/index.js`, generated declarations, and `build/scripts/*.gd` plus the runtime bridge manifest.
5. Confirm the npm artifact excludes `plugins/`, `.agents/`, source files, tests, and local Codex configuration.
6. Build the package tarball and invoke its `godot-plugin` executable through an MCP client, asserting initialization metadata and tool discovery without publishing it.

### Publication gate

Publishing `@cwchanap/godot-plugin@0.1.4` is an external change and requires explicit user approval. The publish command must use the intended npm account, and the package must be public.

### After publication

1. Install the repository marketplace in Codex.
2. Install `godot-plugin@cwchanap`.
3. Start a new Codex task so plugin tools are loaded.
4. Call `get_godot_version`.
5. Call `get_project_info` against a real Godot project.
6. Confirm the tools are exposed under the `mcp__godot__*` namespace.

## Implementation plan requirements

After this amended spec is approved, a separate implementation plan will order the work as follows:

1. Add a failing Vitest identity-contract test against the intended `0.1.4` identity.
2. Update `package.json` and MCP initialization metadata only as required to satisfy that contract.
3. Add the complete plugin and marketplace JSON files.
4. Update `CLAUDE.md`, README identity guidance, and attribution.
5. Run build, tests, plugin validation, package-content checks, and tarball smoke verification.
6. Stop at the explicit npm publication gate.

The plan must call out these risks: an unpublished npm pin cannot launch from the plugin, stale upstream URLs can leak into the new package, version-token drift can break runtime-bridge compatibility, and scoped npm packages default to restricted access without `publishConfig.access: public`.

## Compatibility

Existing local Codex configurations that invoke `/Users/chanwaichan/workspace/godot-mcp/build/index.js` remain valid because this change does not rename the checkout or remove the current entrypoint.

Keeping version `0.1.4` avoids a runtime bridge compatibility break solely from the namespace change. The MCP server continues to report name `godot-mcp`; only the npm package, executable, and Codex plugin use the new `godot-plugin` identity.
