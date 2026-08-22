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

const packageManifest = readJson<PackageManifest>('package.json');
const pluginManifest = readJson<PluginManifest>(
  'plugins/godot-plugin/.codex-plugin/plugin.json'
);
const mcpManifest = readJson<McpManifest>('plugins/godot-plugin/.mcp.json');
const marketplaceManifest = readJson<MarketplaceManifest>(
  '.agents/plugins/marketplace.json'
);

describe('Godot plugin package identity', () => {
  it('publishes the cwchanap package without changing the MCP protocol identity', () => {
    expect(packageManifest).toMatchObject({
      name: '@cwchanap/godot-plugin',
      version: '0.1.4',
      description: 'MCP server for interfacing with Godot game engine. Provides tools for launching the editor, running projects, and capturing debug output.',
      keywords: ['godot', 'mcp', 'ai', 'claude', 'cline'],
      author: 'cwchanap',
      homepage: 'https://github.com/cwchanap/godot-agent-plugin',
      bugs: {
        url: 'https://github.com/cwchanap/godot-agent-plugin/issues',
      },
      repository: {
        type: 'git',
        url: 'https://github.com/cwchanap/godot-agent-plugin.git',
      },
      publishConfig: {
        access: 'public',
      },
      bin: {
        'godot-plugin': './build/index.js',
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
      homepage: 'https://github.com/cwchanap/godot-agent-plugin',
      repository: 'https://github.com/cwchanap/godot-agent-plugin',
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
        websiteURL: 'https://github.com/cwchanap/godot-agent-plugin',
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
