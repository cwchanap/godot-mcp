import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const versionSetterPath = resolve(repoRoot, 'scripts/set-version.js');
const releaseFiles = [
  'package.json',
  'package-lock.json',
  'plugin.json',
  'mcp.json',
  'plugins/godot-plugin/.codex-plugin/plugin.json',
  'plugins/godot-plugin/.claude-plugin/plugin.json',
  'plugins/godot-plugin/.mcp.json',
  'src/godot-server.ts',
  'src/tool-handlers.runtime.spec.ts',
];

type JsonObject = Record<string, any>;

function readJson(root: string, path: string): JsonObject {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as JsonObject;
}

describe('release version setter', () => {
  it('updates every release version source to an arbitrary future version', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'godot-mcp-version-'));

    try {
      for (const path of releaseFiles) {
        const source = resolve(repoRoot, path);
        const destination = resolve(fixtureRoot, path);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(source, destination);
      }

      const result = spawnSync(process.execPath, [versionSetterPath, '9.8.7'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
      });

      expect(result.status, result.stderr).toBe(0);

      const packageManifest = readJson(fixtureRoot, 'package.json');
      const packageLock = readJson(fixtureRoot, 'package-lock.json');
      const portablePlugin = readJson(fixtureRoot, 'plugin.json');
      const portableMcp = readJson(fixtureRoot, 'mcp.json');
      const codexPlugin = readJson(
        fixtureRoot,
        'plugins/godot-plugin/.codex-plugin/plugin.json',
      );
      const claudePlugin = readJson(
        fixtureRoot,
        'plugins/godot-plugin/.claude-plugin/plugin.json',
      );
      const wrapperMcp = readJson(fixtureRoot, 'plugins/godot-plugin/.mcp.json');
      const serverSource = readFileSync(resolve(fixtureRoot, 'src/godot-server.ts'), 'utf8');
      const runtimeTestSource = readFileSync(
        resolve(fixtureRoot, 'src/tool-handlers.runtime.spec.ts'),
        'utf8',
      );

      expect(packageManifest.version).toBe('9.8.7');
      expect(packageLock.version).toBe('9.8.7');
      expect(packageLock.packages[''].version).toBe('9.8.7');
      expect(portablePlugin.version).toBe('9.8.7');
      expect(codexPlugin.version).toBe('9.8.7');
      expect(claudePlugin.version).toBe('9.8.7');
      expect(portableMcp.mcpServers.godot.args).toContain(
        '@cwchanap/godot-plugin@9.8.7',
      );
      expect(wrapperMcp.mcpServers.godot.args).toContain(
        '@cwchanap/godot-plugin@9.8.7',
      );
      expect(serverSource).toContain("version: '9.8.7'");
      expect(runtimeTestSource).toContain("version: '9.8.7'");
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it('is exposed as the package release-version command', () => {
    const packageManifest = readJson(repoRoot, 'package.json');

    expect(packageManifest.scripts['version:set']).toBe('node scripts/set-version.js');
  });

  it('rejects versions with leading-zero numeric components', () => {
    for (const invalid of ['01.2.3', '1.02.3', '1.2.03', '0.0.00']) {
      const result = spawnSync(process.execPath, [versionSetterPath, invalid], {
        cwd: repoRoot,
        encoding: 'utf8',
      });

      expect(result.status, `expected ${invalid} to be rejected`).not.toBe(0);
      expect(result.stderr).toContain('Usage');
    }
  });

  it('is idempotent: rerunning with the current version is a no-op', () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'godot-mcp-version-'));

    try {
      for (const path of releaseFiles) {
        const source = resolve(repoRoot, path);
        const destination = resolve(fixtureRoot, path);
        mkdirSync(dirname(destination), { recursive: true });
        copyFileSync(source, destination);
      }

      const first = spawnSync(process.execPath, [versionSetterPath, '2.0.0'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
      });
      expect(first.status, first.stderr).toBe(0);

      const packageManifestPath = resolve(fixtureRoot, 'package.json');
      const afterFirst = readFileSync(packageManifestPath, 'utf8');

      const second = spawnSync(process.execPath, [versionSetterPath, '2.0.0'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
      });
      expect(second.status, second.stderr).toBe(0);

      const afterSecond = readFileSync(packageManifestPath, 'utf8');
      expect(afterSecond).toBe(afterFirst);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
