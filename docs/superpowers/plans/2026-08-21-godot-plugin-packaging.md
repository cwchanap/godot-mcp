# Godot Plugin Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repackage the existing Godot MCP server as `@cwchanap/godot-plugin@0.1.4` and add a validated repo marketplace wrapper that Codex can install after npm publication.

**Architecture:** Keep the MCP implementation and local development launcher unchanged, while making the npm identity, server metadata, plugin manifest, MCP launcher, and marketplace entry one tested version contract. The Codex plugin remains a thin wrapper whose only runtime path is `npx -y @cwchanap/godot-plugin@0.1.4`; package-content and MCP handshake verification run against the built tarball before the workflow stops at the publication gate.

**Tech Stack:** TypeScript 5.3, Node.js 18+, npm, Vitest 3, MCP TypeScript SDK 0.6.0, Codex plugin JSON, Codex CLI

**Spec:** `docs/superpowers/specs/2026-08-21-godot-plugin-design.md`

## Global Constraints

- Keep the GitHub repository and local checkout named `godot-mcp`; do not rename either.
- Publishable npm identity is exactly `@cwchanap/godot-plugin@0.1.4` with executable `godot-plugin -> build/index.js`.
- Preserve MCP protocol identity `godot-mcp` and plugin MCP server key `godot`, retaining the `mcp__godot__*` tool namespace.
- Keep version `0.1.4` synchronized across `package.json`, `GodotServer` metadata, plugin manifest, and `.mcp.json` package pin.
- Keep the package public through `publishConfig.access: "public"` and publish only `build/` plus npm's automatic metadata files.
- Keep the plugin name and folder exactly `godot-plugin`; add no skill, app, hook, UI, icon, screenshot, authentication service, or hosted MCP server.
- Keep marketplace policy exactly `installation: "AVAILABLE"`, `authentication: "ON_INSTALL"`, category `Developer Tools`, with no `policy.products` override.
- Keep local development on `.codex/config.toml -> node /Users/chanwaichan/workspace/godot-mcp/build/index.js`; do not add a second local launcher.
- Commit no absolute Godot executable path, credential, API key, or local checkout path in distributable plugin JSON.
- Preserve the MIT license and `Copyright (c) 2025 Solomon Elias`; add fork/publisher attribution instead of replacing it.
- Leave Claude, Cline, Cursor, and generic MCP examples on `@coding-solo/godot-mcp` until `@cwchanap/godot-plugin` is actually published.
- Do not claim the new plugin launch path works before publication, and do not run `npm publish` without separate explicit user approval.
- Add no runtime or development dependency.

---

## File Structure

### Create

- `src/plugin-packaging.spec.ts` — locks package, server, plugin, MCP launcher, and marketplace identities into one Vitest contract.
- `.agents/plugins/marketplace.json` — repo marketplace named `cwchanap` with one available Godot plugin entry.
- `plugins/godot-plugin/.codex-plugin/plugin.json` — complete Codex plugin manifest at version `0.1.4`.
- `plugins/godot-plugin/.mcp.json` — stdio launcher pinned to `@cwchanap/godot-plugin@0.1.4` under server key `godot`.
- `scripts/smoke-packed-cli.js` — connects an MCP client to the executable installed from the generated tarball and checks metadata plus tool discovery.
- `docs/superpowers/plans/2026-08-21-godot-plugin-packaging.md` — this implementation plan.

### Modify

- `package.json` — complete `cwchanap` npm identity, public access, and `godot-plugin` executable.
- `package-lock.json` — synchronize the root package name and executable with `package.json`.
- `src/godot-server.ts` — export one `GODOT_SERVER_INFO` constant and use it to initialize the MCP server.
- `README.md` — document the pending Codex marketplace flow, `GODOT_PATH`, new npm identity, and upstream attribution without changing existing-client examples.
- `CLAUDE.md` — replace the stale packaged command and label it unavailable until publication.

---

### Task 1: Lock the npm and MCP server identities together

**Files:**
- Create: `src/plugin-packaging.spec.ts`
- Modify: `src/godot-server.ts:28-58`
- Modify: `package.json:1-33`
- Modify: `package-lock.json:1-31`
- Test: `src/plugin-packaging.spec.ts`
- Test: `src/tool-handlers.runtime.spec.ts:54-68`

**Interfaces:**
- Consumes: the existing MCP `Server` constructor and npm build entrypoint `./build/index.js`.
- Produces: exported constant `GODOT_SERVER_INFO: { readonly name: "godot-mcp"; readonly version: "0.1.4" }` and helper `readJson<T>(relativePath: string): T` inside the contract test.

- [ ] **Step 1: Write the failing package and server identity contract**

Create `src/plugin-packaging.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { GODOT_SERVER_INFO } from './godot-server.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(resolve(repoRoot, relativePath), 'utf8')) as T;
}

type PackageManifest = {
  name: string;
  version: string;
  description: string;
  keywords: string[];
  author: string;
  homepage: string;
  bugs: { url: string };
  repository: { type: string; url: string };
  publishConfig: { access: string };
  bin: Record<string, string>;
  files: string[];
};

const packageManifest = readJson<PackageManifest>('package.json');

describe('Godot plugin package identity', () => {
  it('publishes the cwchanap package without changing the MCP protocol identity', () => {
    expect(packageManifest).toMatchObject({
      name: '@cwchanap/godot-plugin',
      version: '0.1.4',
      description: 'MCP server for interfacing with Godot game engine. Provides tools for launching the editor, running projects, and capturing debug output.',
      keywords: ['godot', 'mcp', 'ai', 'claude', 'cline'],
      author: 'cwchanap',
      homepage: 'https://github.com/cwchanap/godot-mcp',
      bugs: {
        url: 'https://github.com/cwchanap/godot-mcp/issues',
      },
      repository: {
        type: 'git',
        url: 'git+https://github.com/cwchanap/godot-mcp.git',
      },
      publishConfig: {
        access: 'public',
      },
      bin: {
        'godot-plugin': 'build/index.js',
      },
      files: ['build'],
    });
    expect(Object.keys(packageManifest.bin)).toEqual(['godot-plugin']);
    expect(GODOT_SERVER_INFO).toEqual({
      name: 'godot-mcp',
      version: packageManifest.version,
    });
  });
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `rtk npm run test -- src/plugin-packaging.spec.ts`

Expected: FAIL because `src/godot-server.ts` does not export `GODOT_SERVER_INFO`.

- [ ] **Step 3: Export and consume the MCP server metadata constant**

Add above `export class GodotServer` in `src/godot-server.ts`:

```ts
export const GODOT_SERVER_INFO = {
  name: 'godot-mcp',
  version: '0.1.4',
} as const;
```

Replace the inline MCP server implementation object with the constant:

```ts
    this.server = new Server(
      GODOT_SERVER_INFO,
      {
        capabilities: {
          tools: {},
        },
      }
    );
```

- [ ] **Step 4: Re-run the contract test and verify the remaining RED state**

Run: `rtk npm run test -- src/plugin-packaging.spec.ts`

Expected: FAIL because `package.json` still contains the inherited `@coding-solo/godot-mcp` identity and `godot-mcp` executable.

- [ ] **Step 5: Update the complete npm identity**

Set these exact fields in `package.json`, preserving all unshown fields and dependency versions:

```json
{
  "name": "@cwchanap/godot-plugin",
  "version": "0.1.4",
  "homepage": "https://github.com/cwchanap/godot-mcp",
  "bugs": {
    "url": "https://github.com/cwchanap/godot-mcp/issues"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/cwchanap/godot-mcp.git"
  },
  "license": "MIT",
  "author": "cwchanap",
  "publishConfig": {
    "access": "public"
  },
  "bin": {
    "godot-plugin": "build/index.js"
  },
  "files": [
    "build"
  ]
}
```

Regenerate only the lockfile metadata:

Run: `rtk npm install --package-lock-only --ignore-scripts`

Expected: `package-lock.json` root `name` becomes `@cwchanap/godot-plugin`, its version stays `0.1.4`, and its root bin becomes `godot-plugin: build/index.js`; dependency resolutions do not change.

- [ ] **Step 6: Verify the identity contract and existing MCP handshake**

Run: `rtk npm run test -- src/plugin-packaging.spec.ts src/tool-handlers.runtime.spec.ts`

Expected: PASS; the real in-memory MCP connection still reports `{ name: "godot-mcp", version: "0.1.4" }`.

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the npm and server identity contract**

```bash
rtk git add package.json package-lock.json src/godot-server.ts src/plugin-packaging.spec.ts
rtk git commit -m "build: adopt cwchanap Godot plugin identity"
```

---

### Task 2: Add the Codex plugin and repo marketplace manifests

**Files:**
- Create: `plugins/godot-plugin/.codex-plugin/plugin.json`
- Create: `plugins/godot-plugin/.mcp.json`
- Create: `.agents/plugins/marketplace.json`
- Modify: `src/plugin-packaging.spec.ts`
- Test: `src/plugin-packaging.spec.ts`

**Interfaces:**
- Consumes: `readJson<T>()`, `packageManifest`, and `GODOT_SERVER_INFO` from Task 1.
- Produces: plugin `godot-plugin@0.1.4`, MCP server entry `godot`, pinned launcher `npx -y @cwchanap/godot-plugin@0.1.4`, and marketplace selector `godot-plugin@cwchanap`.

- [ ] **Step 1: Extend the contract test before creating any plugin files**

Add these types, reads, helper, and tests to `src/plugin-packaging.spec.ts`:

```ts
type PluginManifest = {
  name: string;
  version: string;
  description: string;
  author: { name: string; url: string };
  homepage: string;
  repository: string;
  license: string;
  keywords: string[];
  mcpServers: string;
  interface: {
    displayName: string;
    shortDescription: string;
    longDescription: string;
    developerName: string;
    category: string;
    capabilities: string[];
    websiteURL: string;
    defaultPrompt: string[];
  };
};

type McpManifest = {
  mcpServers: Record<string, {
    type: string;
    command: string;
    args: string[];
  }>;
};

type MarketplaceManifest = {
  name: string;
  interface: { displayName: string };
  plugins: Array<{
    name: string;
    source: { source: string; path: string };
    policy: { installation: string; authentication: string };
    category: string;
  }>;
};

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

const pluginManifest = readJson<PluginManifest>(
  'plugins/godot-plugin/.codex-plugin/plugin.json'
);
const mcpManifest = readJson<McpManifest>('plugins/godot-plugin/.mcp.json');
const marketplaceManifest = readJson<MarketplaceManifest>(
  '.agents/plugins/marketplace.json'
);

describe('Codex plugin wrapper identity', () => {
  it('matches the complete manifest contract', () => {
    expect(pluginManifest).toEqual({
      name: 'godot-plugin',
      version: packageManifest.version,
      description: 'Connect Codex to local Godot projects through the Godot MCP server.',
      author: {
        name: 'cwchanap',
        url: 'https://github.com/cwchanap',
      },
      homepage: 'https://github.com/cwchanap/godot-mcp',
      repository: 'https://github.com/cwchanap/godot-mcp',
      license: 'MIT',
      keywords: ['godot', 'mcp', 'codex', 'game-development'],
      mcpServers: './.mcp.json',
      interface: {
        displayName: 'Godot Plugin',
        shortDescription: 'Inspect, run, and control local Godot projects.',
        longDescription: 'Connect Codex to the local Godot editor and runtime for project inspection, scene operations, execution, logs, and runtime controls.',
        developerName: 'cwchanap',
        category: 'Developer Tools',
        capabilities: ['Read', 'Write'],
        websiteURL: 'https://github.com/cwchanap/godot-mcp',
        defaultPrompt: [
          'Inspect this Godot project and summarize its structure.',
          'Run this Godot project and diagnose any errors.',
          'Use Godot tools to implement and verify this change.',
        ],
      },
    });
  });

  it('pins the published package under the stable godot server key', () => {
    expect(mcpManifest).toEqual({
      mcpServers: {
        godot: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', `@cwchanap/godot-plugin@${GODOT_SERVER_INFO.version}`],
        },
      },
    });
  });

  it('publishes the plugin through the cwchanap repo marketplace', () => {
    expect(marketplaceManifest).toEqual({
      name: 'cwchanap',
      interface: {
        displayName: 'cwchanap',
      },
      plugins: [
        {
          name: 'godot-plugin',
          source: {
            source: 'local',
            path: './plugins/godot-plugin',
          },
          policy: {
            installation: 'AVAILABLE',
            authentication: 'ON_INSTALL',
          },
          category: 'Developer Tools',
        },
      ],
    });
  });

  it('contains no absolute filesystem paths in distributable plugin JSON', () => {
    const absolutePaths = collectStrings([pluginManifest, mcpManifest]).filter(
      (value) => value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
    );
    expect(absolutePaths).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the extended contract and verify RED**

Run: `rtk npm run test -- src/plugin-packaging.spec.ts`

Expected: FAIL with `ENOENT` for `plugins/godot-plugin/.codex-plugin/plugin.json`.

- [ ] **Step 3: Create the complete plugin manifest**

Create `plugins/godot-plugin/.codex-plugin/plugin.json`:

```json
{
  "name": "godot-plugin",
  "version": "0.1.4",
  "description": "Connect Codex to local Godot projects through the Godot MCP server.",
  "author": {
    "name": "cwchanap",
    "url": "https://github.com/cwchanap"
  },
  "homepage": "https://github.com/cwchanap/godot-mcp",
  "repository": "https://github.com/cwchanap/godot-mcp",
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
    "websiteURL": "https://github.com/cwchanap/godot-mcp",
    "defaultPrompt": [
      "Inspect this Godot project and summarize its structure.",
      "Run this Godot project and diagnose any errors.",
      "Use Godot tools to implement and verify this change."
    ]
  }
}
```

- [ ] **Step 4: Create the pinned MCP launcher**

Create `plugins/godot-plugin/.mcp.json`:

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

- [ ] **Step 5: Create the repo marketplace**

Create `.agents/plugins/marketplace.json`:

```json
{
  "name": "cwchanap",
  "interface": {
    "displayName": "cwchanap"
  },
  "plugins": [
    {
      "name": "godot-plugin",
      "source": {
        "source": "local",
        "path": "./plugins/godot-plugin"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

- [ ] **Step 6: Verify the complete JSON contract**

Run: `rtk npm run test -- src/plugin-packaging.spec.ts`

Expected: PASS with five identity/wrapper assertions and no absolute filesystem paths.

Run: `rtk npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the Codex wrapper**

```bash
rtk git add .agents/plugins/marketplace.json plugins/godot-plugin/.codex-plugin/plugin.json plugins/godot-plugin/.mcp.json src/plugin-packaging.spec.ts
rtk git commit -m "feat: add Codex Godot plugin wrapper"
```

---

### Task 3: Document pending publication and preserve upstream attribution

**Files:**
- Modify: `README.md:95-235,283-302`
- Modify: `CLAUDE.md:5-10`

**Interfaces:**
- Consumes: marketplace selector `godot-plugin@cwchanap`, npm package `@cwchanap/godot-plugin@0.1.4`, and inherited `GODOT_PATH` behavior.
- Produces: post-publication Codex install commands and explicit pre-publication status without altering existing-client instructions.

- [ ] **Step 1: Record the inherited examples before editing**

Run:

```bash
rtk rg -n "@coding-solo/godot-mcp" README.md
```

Expected: matches remain in the Claude Code, Cline, Cursor, and generic MCP sections. Save this output for comparison after the edit; those lines must not be replaced in this task.

- [ ] **Step 2: Add the pending Codex plugin section**

Insert this section immediately after `## Quick Start` and before `### Claude Code` in `README.md`:

````markdown
### Codex Plugin (pending publication)

The Codex wrapper uses `@cwchanap/godot-plugin@0.1.4`. Its `npx` launch path is unavailable until that package is published to npm.

After publication, add this repository as a marketplace and install the plugin:

```bash
codex plugin marketplace add cwchanap/godot-mcp
codex plugin add godot-plugin@cwchanap
```

Start a new Codex task after installation so the `mcp__godot__*` tools are loaded. If Godot is not discovered automatically, set `GODOT_PATH` in the environment that launches Codex and reopen the task.
````

- [ ] **Step 3: Add publisher and upstream attribution**

Insert this section immediately before `## License` in `README.md`:

```markdown
## Attribution

This fork is maintained by `cwchanap`. It is based on [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp) by Solomon Elias and remains available under the MIT License.
```

- [ ] **Step 4: Update the packaged development command without claiming availability**

Replace the packaged command line in `CLAUDE.md` with:

```markdown
- **Run (packaged, after publication)**: `npx @cwchanap/godot-plugin` - Executes the published CLI without cloning the repo; unavailable until the package is published
```

- [ ] **Step 5: Verify documentation identity boundaries**

Run:

```bash
rtk rg -n "@cwchanap/godot-plugin|godot-plugin@cwchanap|pending publication|after publication|GODOT_PATH|Coding-Solo/godot-mcp|Solomon Elias" README.md CLAUDE.md
```

Expected: the pending Codex section, new package, marketplace selector, environment troubleshooting, and attribution are present.

Run:

```bash
rtk rg -n "@coding-solo/godot-mcp" README.md
```

Expected: the pre-edit Claude Code, Cline, Cursor, and generic MCP examples still point to `@coding-solo/godot-mcp`.

- [ ] **Step 6: Commit the documentation**

```bash
rtk git add README.md CLAUDE.md
rtk git commit -m "docs: describe Codex plugin installation"
```

---

### Task 4: Add a reusable packed-executable MCP smoke client

**Files:**
- Create: `scripts/smoke-packed-cli.js`

**Interfaces:**
- Consumes: one executable filesystem path in `process.argv[2]` and MCP SDK `Client` plus `StdioClientTransport`.
- Produces: exit code `0` only when the installed tarball executable reports `godot-mcp@0.1.4` and lists a `get_godot_version` tool; exit code `1` for a contract failure and `2` for missing input.

- [ ] **Step 1: Verify the smoke script does not exist**

Run: `rtk node --check scripts/smoke-packed-cli.js`

Expected: FAIL because `scripts/smoke-packed-cli.js` does not exist.

- [ ] **Step 2: Implement the packed-executable smoke client**

Create `scripts/smoke-packed-cli.js`:

```js
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const binaryArgument = process.argv[2];

if (!binaryArgument) {
  console.error('Usage: node scripts/smoke-packed-cli.js <godot-plugin-binary>');
  process.exit(2);
}

const binaryPath = resolve(binaryArgument);
await access(binaryPath);

const transport = new StdioClientTransport({
  command: binaryPath,
  stderr: 'inherit',
});
const client = new Client(
  {
    name: 'godot-plugin-package-smoke',
    version: '1.0.0',
  },
  {
    capabilities: {},
  }
);

try {
  await client.connect(transport);

  const serverVersion = client.getServerVersion();
  if (serverVersion?.name !== 'godot-mcp' || serverVersion.version !== '0.1.4') {
    throw new Error(`Unexpected MCP server metadata: ${JSON.stringify(serverVersion)}`);
  }

  const { tools } = await client.listTools();
  if (!tools.some((tool) => tool.name === 'get_godot_version')) {
    throw new Error('Packed server did not expose get_godot_version.');
  }

  console.log(JSON.stringify({
    serverVersion,
    toolCount: tools.length,
  }));
} finally {
  await client.close();
}
```

- [ ] **Step 3: Verify syntax and missing-argument behavior**

Run: `rtk node --check scripts/smoke-packed-cli.js`

Expected: PASS.

Run: `rtk node scripts/smoke-packed-cli.js`

Expected: exit code `2` with `Usage: node scripts/smoke-packed-cli.js <godot-plugin-binary>`.

- [ ] **Step 4: Commit the smoke client**

```bash
rtk git add scripts/smoke-packed-cli.js
rtk git commit -m "test: add packed Godot plugin smoke client"
```

---

### Task 5: Validate the plugin and package without publishing

**Files:**
- Verify: `plugins/godot-plugin/.codex-plugin/plugin.json`
- Verify: `plugins/godot-plugin/.mcp.json`
- Verify: `.agents/plugins/marketplace.json`
- Verify: generated npm tarball under a task-specific temporary directory

**Interfaces:**
- Consumes: the complete repository state from Tasks 1-4 and external Codex validator at `/Users/chanwaichan/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py`.
- Produces: structural validation, build/test evidence, exact tarball-content evidence, and a real MCP initialization/tool-list handshake from the installed tarball executable.

- [ ] **Step 1: Run repository verification**

Run:

```bash
rtk npm run typecheck
rtk npm run build
rtk npm run test
```

Expected: all three commands PASS; the build regenerates `build/scripts/runtime_bridge.gd` and `build/scripts/runtime_bridge_manifest.json` with version `0.1.4`.

- [ ] **Step 2: Run the external Codex plugin validator**

Run:

```bash
rtk python3 /Users/chanwaichan/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/godot-plugin
```

Expected: PASS with a valid `godot-plugin` manifest and MCP companion file.

- [ ] **Step 3: Dry-run npm packing with a writable temporary cache**

Run:

```bash
GODOT_PLUGIN_PACK_DIR="$(rtk mktemp -d /private/tmp/godot-plugin-pack.XXXXXX)"
rtk env npm_config_cache="$GODOT_PLUGIN_PACK_DIR/npm-cache" npm pack --dry-run --json
```

Expected: package name `@cwchanap/godot-plugin`, version `0.1.4`, and no npm access or permission error.

- [ ] **Step 4: Build and inspect the real tarball**

Run:

```bash
rtk env npm_config_cache="$GODOT_PLUGIN_PACK_DIR/npm-cache" npm pack --json --pack-destination "$GODOT_PLUGIN_PACK_DIR"
rtk tar -tzf "$GODOT_PLUGIN_PACK_DIR/cwchanap-godot-plugin-0.1.4.tgz" | rtk sort
```

Expected required entries include:

```text
package/LICENSE
package/README.md
package/build/index.d.ts
package/build/index.js
package/build/scripts/editor_reimport.gd
package/build/scripts/godot_operations.gd
package/build/scripts/runtime_bridge.gd
package/build/scripts/runtime_bridge_manifest.json
package/package.json
```

Run the exclusion check:

```bash
if rtk tar -tzf "$GODOT_PLUGIN_PACK_DIR/cwchanap-godot-plugin-0.1.4.tgz" | rtk rg '^package/(plugins|\.agents|src|\.codex)(/|$)|\.spec\.'; then
  exit 1
fi
```

Expected: exit code `0` from the shell block because no plugin wrapper, agent metadata, source, local Codex configuration, or test file is packaged.

- [ ] **Step 5: Install the tarball into an isolated consumer**

Run:

```bash
rtk mkdir -p "$GODOT_PLUGIN_PACK_DIR/consumer"
rtk env npm_config_cache="$GODOT_PLUGIN_PACK_DIR/npm-cache" npm install --prefix "$GODOT_PLUGIN_PACK_DIR/consumer" "$GODOT_PLUGIN_PACK_DIR/cwchanap-godot-plugin-0.1.4.tgz"
```

Expected: PASS and create executable `$GODOT_PLUGIN_PACK_DIR/consumer/node_modules/.bin/godot-plugin` without publishing or resolving `@cwchanap/godot-plugin` from the registry.

- [ ] **Step 6: Exercise the installed executable through a real MCP client**

Run:

```bash
rtk node scripts/smoke-packed-cli.js "$GODOT_PLUGIN_PACK_DIR/consumer/node_modules/.bin/godot-plugin"
```

Expected: PASS and print JSON containing `serverVersion.name: "godot-mcp"`, `serverVersion.version: "0.1.4"`, and a positive `toolCount`.

- [ ] **Step 7: Check the final diff and stop at the publication gate**

Run:

```bash
rtk git diff --check
rtk git status --short --branch
rtk git log -5 --oneline
```

Expected: no uncommitted implementation changes, no whitespace errors, and four focused implementation commits after this plan commit.

Do not run `npm publish`. Report the validated tarball path, the exact package/version, and that marketplace runtime installation remains pending explicit publication approval.

## Post-publication acceptance checklist

Execute this checklist only after the user separately approves and completes npm publication:

1. Run `rtk codex plugin marketplace add cwchanap/godot-mcp`.
2. Run `rtk codex plugin add godot-plugin@cwchanap`.
3. Start a new Codex task so plugin tools are loaded.
4. Call `get_godot_version` and confirm the installed Godot version is returned.
5. Call `get_project_info` against a real Godot project.
6. Confirm callable tools use the `mcp__godot__*` namespace.
