import { existsSync, readFileSync } from 'node:fs';
import { dirname, posix, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { GODOT_SERVER_INFO } from './godot-server.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = resolve(repoRoot, 'plugins/godot-plugin');

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
  scripts: Record<string, string>;
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

type AgentPluginManifest = {
  $schema: string;
  name: string;
  version: string;
  description: string;
  author: { name: string; url: string };
  homepage: string;
  repository: string;
  license: string;
  keywords: string[];
};

type PortableMcpManifest = McpManifest & {
  $schema: string;
};

type ClaudePluginManifest = Omit<PluginManifest, 'interface'> & {
  displayName: string;
};

type ClaudeMarketplaceManifest = {
  name: string;
  owner: { name: string; url: string };
  plugins: Array<{
    name: string;
    source: string;
    description: string;
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

function isAbsolutePath(value: string): boolean {
  return posix.isAbsolute(value) || win32.isAbsolute(value);
}

const packageManifest = readJson<PackageManifest>('package.json');
const pluginManifest = readJson<PluginManifest>(
  'plugins/godot-plugin/.codex-plugin/plugin.json'
);
const mcpManifest = readJson<McpManifest>('plugins/godot-plugin/.mcp.json');
const marketplaceManifest = readJson<MarketplaceManifest>(
  '.agents/plugins/marketplace.json'
);
const agentPluginManifest = readJson<AgentPluginManifest>('plugin.json');
const portableMcpManifest = readJson<PortableMcpManifest>('mcp.json');
const claudePluginManifest = readJson<ClaudePluginManifest>(
  'plugins/godot-plugin/.claude-plugin/plugin.json'
);
const claudeMarketplaceManifest = readJson<ClaudeMarketplaceManifest>(
  '.claude-plugin/marketplace.json'
);
const ciWorkflow = readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8');

describe('Godot plugin package identity', () => {
  it('publishes the cwchanap package without changing the MCP protocol identity', () => {
    expect(packageManifest).toMatchObject({
      name: '@cwchanap/godot-plugin',
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
      files: ['build', 'plugin.json', 'mcp.json'],
      scripts: {
        'smoke:packed': 'node scripts/smoke-packed-cli.js build/index.js',
      },
    });
    expect(Object.keys(packageManifest.bin)).toEqual(['godot-plugin']);
    expect(GODOT_SERVER_INFO).toEqual({
      name: 'godot-mcp',
      version: packageManifest.version,
    });
  });

  it('runs the packed CLI smoke check in CI', () => {
    expect(ciWorkflow).toContain('run: npm run smoke:packed');
  });
});

describe('Portable Agent Plugins identity', () => {
  it('matches the package version and Agent Plugins 1.0 schema', () => {
    expect(agentPluginManifest).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
      name: 'godot-plugin',
      version: packageManifest.version,
      description: 'Connect AI coding agents to local Godot projects through the Godot MCP server.',
      author: {
        name: 'cwchanap',
        url: 'https://github.com/cwchanap',
      },
      homepage: 'https://github.com/cwchanap/godot-mcp',
      repository: 'https://github.com/cwchanap/godot-mcp',
      license: 'MIT',
      keywords: ['godot', 'mcp', 'agent-plugin', 'game-development'],
    });
  });

  it('pins the same stdio launcher as the native plugin wrapper', () => {
    expect(portableMcpManifest).toEqual({
      $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      mcpServers: {
        godot: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', `@cwchanap/godot-plugin@${GODOT_SERVER_INFO.version}`],
          // cwd avoids npx self-shadowing: repo package.json matches this name@version.
          cwd: '${PLUGIN_DATA}',
        },
      },
    });
    expect(portableMcpManifest.mcpServers.godot).toMatchObject(
      mcpManifest.mcpServers.godot,
    );
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

  it('resolves the declared MCP config from the plugin root', () => {
    expect(existsSync(resolve(pluginRoot, pluginManifest.mcpServers))).toBe(true);
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

  it('makes the published plugin installable from the cwchanap repo marketplace', () => {
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
    const absolutePaths = collectStrings([pluginManifest, mcpManifest]).filter(isAbsolutePath);
    expect(absolutePaths).toEqual([]);
  });
});

describe('Claude Code plugin wrapper identity', () => {
  it('matches the package version and reuses the wrapper MCP config', () => {
    expect(claudePluginManifest).toEqual({
      name: 'godot-plugin',
      displayName: 'Godot Plugin',
      version: packageManifest.version,
      description: 'Connect Claude Code to local Godot projects through the Godot MCP server.',
      author: {
        name: 'cwchanap',
        url: 'https://github.com/cwchanap',
      },
      homepage: 'https://github.com/cwchanap/godot-mcp',
      repository: 'https://github.com/cwchanap/godot-mcp',
      license: 'MIT',
      keywords: ['godot', 'mcp', 'claude-code', 'game-development'],
      mcpServers: './.mcp.json',
    });
    expect(existsSync(resolve(pluginRoot, claudePluginManifest.mcpServers))).toBe(true);
  });

  it('exposes the wrapper through the repository Claude marketplace', () => {
    expect(claudeMarketplaceManifest).toEqual({
      name: 'cwchanap',
      owner: {
        name: 'cwchanap',
        url: 'https://github.com/cwchanap',
      },
      plugins: [
        {
          name: 'godot-plugin',
          source: './plugins/godot-plugin',
          description: 'Inspect, run, author, and control local Godot projects through MCP.',
        },
      ],
    });
  });
});

describe('Cross-agent distributable path hygiene', () => {
  it('recognizes POSIX and Windows absolute path forms', () => {
    expect([
      '/tmp/plugin.json',
      'C:\\plugin\\plugin.json',
      '\\plugin\\plugin.json',
      '\\\\server\\share\\plugin.json',
    ].every(isAbsolutePath)).toBe(true);
    expect(isAbsolutePath('plugins/godot-plugin/.mcp.json')).toBe(false);
  });

  it('contains no absolute paths in portable and Claude metadata', () => {
    const absolutePaths = collectStrings([
      agentPluginManifest,
      portableMcpManifest,
      claudePluginManifest,
      claudeMarketplaceManifest,
    ]).filter(isAbsolutePath);

    expect(absolutePaths).toEqual([]);
  });
});
