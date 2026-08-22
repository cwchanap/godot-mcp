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
        url: 'https://github.com/cwchanap/godot-mcp.git',
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
