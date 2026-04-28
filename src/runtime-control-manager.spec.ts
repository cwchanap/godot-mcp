import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeControlManager } from './runtime-control-manager.js';

const packageVersion = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).version as string;
const projectPath = path.join(process.cwd(), '.test-artifacts', 'runtime-control-project');
const bridgeDir = path.join(projectPath, 'addons', 'godot_mcp_runtime');
const manifestPath = path.join(bridgeDir, 'bridge_manifest.json');
const projectConfigPath = path.join(projectPath, 'project.godot');

describe('RuntimeControlManager', () => {
  const manager = new RuntimeControlManager();

  beforeEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    await mkdir(projectPath, { recursive: true });
    await writeFile(
      projectConfigPath,
      '[autoload]\nGodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"\n'
    );
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
  });

  it('reports no active runtime session before launch', () => {
    expect(manager.getRuntimeState()).toEqual({
      connected: false,
      sessionId: null,
      scenePath: null,
    });
  });

  it('installs the bridge addon into addons/godot_mcp_runtime', async () => {
    const status = await manager.installBridge(projectPath);

    expect(status.installed).toBe(true);
    expect(status.version).toBe(packageVersion);
    await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.toContain(packageVersion);
    await expect(readFile(manifestPath, 'utf8')).resolves.toContain(packageVersion);
  });

  it('reads bridge status from bridge_manifest.json', async () => {
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          name: 'godot_mcp_runtime',
          version: packageVersion,
          autoloadName: 'GodotMcpRuntimeBridge',
          entryScript: 'runtime_bridge.gd',
        },
        null,
        2
      )
    );

    expect(await manager.getBridgeStatus(projectPath)).toEqual({
      installed: true,
      version: packageVersion,
      compatible: true,
    });
  });

  it('reports an incompatible bridge when bridge_manifest.json is invalid', async () => {
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(manifestPath, '{invalid json');

    expect(await manager.getBridgeStatus(projectPath)).toEqual({
      installed: true,
      version: null,
      compatible: false,
    });
  });

  it('updates the bridge in place and preserves the autoload entry', async () => {
    await manager.installBridge(projectPath);
    await manager.updateBridge(projectPath);

    expect(await manager.getBridgeStatus(projectPath)).toEqual(expect.objectContaining({
      installed: true,
      compatible: true,
    }));
    await expect(readFile(projectConfigPath, 'utf8')).resolves.toContain(
      'GodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"'
    );
  });
});
