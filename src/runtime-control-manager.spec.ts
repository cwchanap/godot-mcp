import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeControlManager } from './runtime-control-manager.js';

const projectPath = path.join(process.cwd(), '.test-artifacts', 'runtime-control-project');
const generatedAssetsPath = path.join(process.cwd(), '.test-artifacts', 'runtime-control-assets');
const bridgeDir = path.join(projectPath, 'addons', 'godot_mcp_runtime');
const manifestPath = path.join(bridgeDir, 'bridge_manifest.json');
const projectConfigPath = path.join(projectPath, 'project.godot');
const sourceBridgeManifestPath = path.join(process.cwd(), 'src', 'scripts', 'runtime_bridge_manifest.json');
const sourceBridgeScriptPath = path.join(process.cwd(), 'src', 'scripts', 'runtime_bridge.gd');
const packageJsonPath = path.join(process.cwd(), 'package.json');

async function writeGeneratedBridgeAssets(version: string): Promise<void> {
  const manifestTemplate = await readFile(sourceBridgeManifestPath, 'utf8');
  const scriptTemplate = await readFile(sourceBridgeScriptPath, 'utf8');

  await mkdir(generatedAssetsPath, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(generatedAssetsPath, 'runtime_bridge_manifest.json'),
      manifestTemplate.replaceAll('__PACKAGE_VERSION__', version)
    ),
    writeFile(
      path.join(generatedAssetsPath, 'runtime_bridge.gd'),
      scriptTemplate.replaceAll('__PACKAGE_VERSION__', version)
    ),
  ]);
}

describe('RuntimeControlManager', () => {
  let bridgeVersion = '';

  beforeEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    await rm(generatedAssetsPath, { recursive: true, force: true });
    await mkdir(projectPath, { recursive: true });
    bridgeVersion = JSON.parse(await readFile(packageJsonPath, 'utf8')).version as string;
    await writeGeneratedBridgeAssets(bridgeVersion);
    await writeFile(
      projectConfigPath,
      '[autoload]\nGodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"\n'
    );
  });

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    await rm(generatedAssetsPath, { recursive: true, force: true });
  });

  it('reports no active runtime session before launch', () => {
    const manager = new RuntimeControlManager();
    expect(manager.getRuntimeState()).toEqual({
      connected: false,
      sessionId: null,
      scenePath: null,
    });
  });

  it('installs the bridge addon into addons/godot_mcp_runtime', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const status = await manager.installBridge(projectPath);

    expect(status.installed).toBe(true);
    expect(status.version).toBe(bridgeVersion);
    await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.toContain(bridgeVersion);
    await expect(readFile(manifestPath, 'utf8')).resolves.toContain(bridgeVersion);
  });

  it('reads bridge status from bridge_manifest.json', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          name: 'godot_mcp_runtime',
          version: bridgeVersion,
          autoloadName: 'GodotMcpRuntimeBridge',
          entryScript: 'runtime_bridge.gd',
        },
        null,
        2
      )
    );

    expect(await manager.getBridgeStatus(projectPath)).toEqual({
      installed: true,
      version: bridgeVersion,
      compatible: true,
    });
  });

  it('reports an incompatible bridge when bridge_manifest.json is invalid', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(manifestPath, '{invalid json');

    expect(await manager.getBridgeStatus(projectPath)).toEqual({
      installed: true,
      version: null,
      compatible: false,
    });
  });

  it('updates the bridge in place and preserves the autoload entry', async () => {
    const generatedVersion = '9.9.9-test';
    const staleVersion = '0.0.1-stale';

    await writeGeneratedBridgeAssets(generatedVersion);

    await mkdir(bridgeDir, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          name: 'godot_mcp_runtime',
          version: staleVersion,
          autoloadName: 'GodotMcpRuntimeBridge',
          entryScript: 'runtime_bridge.gd',
        },
        null,
        2
      )
    );
    await writeFile(
      path.join(bridgeDir, 'runtime_bridge.gd'),
      (await readFile(sourceBridgeScriptPath, 'utf8')).replaceAll('__PACKAGE_VERSION__', staleVersion)
    );

    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    await manager.updateBridge(projectPath);

    expect(await manager.getBridgeStatus(projectPath)).toEqual(expect.objectContaining({
      installed: true,
      version: generatedVersion,
      compatible: true,
    }));
    await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.toContain(generatedVersion);
    await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.not.toContain(staleVersion);
    await expect(readFile(projectConfigPath, 'utf8')).resolves.toContain(
      'GodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"'
    );
  });
});
