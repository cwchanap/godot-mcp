import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RuntimeControlManager } from './runtime-control-manager.js';

const projectPath = path.join(process.cwd(), '.test-artifacts', 'runtime-control-project');
const generatedAssetsPath = path.join(process.cwd(), '.test-artifacts', 'runtime-control-assets');
const bridgeDir = path.join(projectPath, 'addons', 'godot_mcp_runtime');
const manifestPath = path.join(bridgeDir, 'bridge_manifest.json');
const projectFile = path.join(projectPath, 'project.godot');
const sourceBridgeManifestPath = path.join(process.cwd(), 'src', 'scripts', 'runtime_bridge_manifest.json');
const sourceBridgeScriptPath = path.join(process.cwd(), 'src', 'scripts', 'runtime_bridge.gd');
const packageJsonPath = path.join(process.cwd(), 'package.json');
const runtimeBridgeAutoloadKey = 'autoload/GodotMcpRuntimeBridge=';
const canonicalRuntimeBridgeAutoloadLine =
  'autoload/GodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"';

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
  let manager: RuntimeControlManager;

  beforeEach(() => {
    manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
  });

  

  

  let bridgeVersion = '';

  beforeEach(async () => {
    await rm(projectPath, { recursive: true, force: true });
    await rm(generatedAssetsPath, { recursive: true, force: true });
    await mkdir(projectPath, { recursive: true });
    await writeFile(projectFile, '[application]\nconfig/name="Runtime Control Test"\n');
    bridgeVersion = JSON.parse(await readFile(packageJsonPath, 'utf8')).version as string;
    await writeGeneratedBridgeAssets(bridgeVersion);
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

  it('registers the GodotMcpRuntimeBridge autoload entry during install', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });

    await manager.installBridge(projectPath);

    const projectContents = await readFile(projectFile, 'utf8');
    expect(projectContents).toContain(runtimeBridgeAutoloadKey);
  });

  it('replaces existing bridge autoload variants with exactly one canonical entry during install', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    await writeFile(
      projectFile,
      `[application]\nconfig/name="Runtime Control Test"\n\n[autoload]\nautoload/GodotMcpRuntimeBridge="*res://legacy/runtime_bridge.gd"\nautoload/OtherBridge="*res://addons/other/runtime_bridge.gd"\n`
    );

    await manager.installBridge(projectPath);

    const projectContents = await readFile(projectFile, 'utf8');
    const bridgeEntries = projectContents
      .split('\n')
      .filter((line) => line.startsWith(runtimeBridgeAutoloadKey));

    expect(bridgeEntries).toEqual([canonicalRuntimeBridgeAutoloadLine]);
    expect(projectContents).toContain('autoload/OtherBridge="*res://addons/other/runtime_bridge.gd"');
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
    await writeFile(path.join(bridgeDir, 'runtime_bridge.gd'), await readFile(sourceBridgeScriptPath, 'utf8'));

    expect(await manager.getBridgeStatus(projectPath)).toEqual({
      installed: true,
      version: bridgeVersion,
      compatible: true,
    });
  });

  it('reports the bridge as not installed when runtime_bridge.gd is missing', async () => {
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
      installed: false,
      version: null,
      compatible: false,
    });
  });

  it('reports an incompatible bridge when bridge_manifest.json is invalid', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    await mkdir(bridgeDir, { recursive: true });
    await writeFile(manifestPath, '{invalid json');
    await writeFile(path.join(bridgeDir, 'runtime_bridge.gd'), await readFile(sourceBridgeScriptPath, 'utf8'));

    expect(await manager.getBridgeStatus(projectPath)).toEqual({
      installed: true,
      version: null,
      compatible: false,
    });
  });

  it('reports an installed but incompatible bridge when bridge_manifest.json is stale', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const staleVersion = '0.0.1-stale';
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

    expect(await manager.getBridgeStatus(projectPath)).toEqual({
      installed: true,
      version: staleVersion,
      compatible: false,
    });
  });

  it('throws when generated bridge manifest metadata is invalid', async () => {
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
    await writeFile(path.join(bridgeDir, 'runtime_bridge.gd'), await readFile(sourceBridgeScriptPath, 'utf8'));
    await writeFile(path.join(generatedAssetsPath, 'runtime_bridge_manifest.json'), JSON.stringify({ name: 'broken' }));

    await expect(manager.getBridgeStatus(projectPath)).rejects.toThrow(
      /Generated runtime bridge manifest is missing a version/
    );
  });

  it('updates the bridge asset files in place', async () => {
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
    const status = await manager.updateBridge(projectPath);

    expect(status).toEqual(expect.objectContaining({
      installed: true,
      version: generatedVersion,
      compatible: true,
    }));
    await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.toContain(generatedVersion);
    await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.not.toContain(staleVersion);
  });

  it('refuses uninstall while the bridge session is active', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    manager.setActiveSessionForTest('session-1');

    await expect(manager.uninstallBridge(projectPath)).rejects.toThrow(/running session/i);
  });

  it('removes the owned autoload entry during uninstall', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    await manager.installBridge(projectPath);

    await manager.uninstallBridge(projectPath);

    await expect(readFile(projectFile, 'utf8')).resolves.not.toContain(runtimeBridgeAutoloadKey);
  });

  it('removes owned bridge autoload variants during uninstall', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    await writeFile(
      projectFile,
      `[application]\nconfig/name="Runtime Control Test"\n\n[autoload]\nautoload/GodotMcpRuntimeBridge="*res://legacy/runtime_bridge.gd"\nautoload/OtherBridge="*res://addons/other/runtime_bridge.gd"\n`
    );

    await manager.uninstallBridge(projectPath);

    const projectContents = await readFile(projectFile, 'utf8');

    expect(projectContents).not.toContain(runtimeBridgeAutoloadKey);
    expect(projectContents).toContain('autoload/OtherBridge="*res://addons/other/runtime_bridge.gd"');
  });

  it('preserves later config sections (e.g. [editor_plugins]) after [autoload] during install and uninstall', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const initialProjectGodot = `
[application]
config/name="Runtime Control Test"

[autoload]
autoload/OtherBridge="*res://addons/other/runtime_bridge.gd"

[editor_plugins]
plugin_list={"MyPlugin":true}
`;
    await writeFile(projectFile, initialProjectGodot);

    // Install bridge
    await manager.installBridge(projectPath);
    let projectContents = await readFile(projectFile, 'utf8');
    // [editor_plugins] section and its contents must be preserved
    expect(projectContents).toContain('[editor_plugins]');
    expect(projectContents).toContain('plugin_list={"MyPlugin":true}');
    // The bridge autoload must be present
    expect(projectContents).toContain(runtimeBridgeAutoloadKey);
    // The other autoload must be present
    expect(projectContents).toContain('autoload/OtherBridge="*res://addons/other/runtime_bridge.gd"');

    // Uninstall bridge
    await manager.uninstallBridge(projectPath);
    projectContents = await readFile(projectFile, 'utf8');
    // [editor_plugins] section and its contents must still be preserved
    expect(projectContents).toContain('[editor_plugins]');
    expect(projectContents).toContain('plugin_list={"MyPlugin":true}');
    // The bridge autoload must be gone
    expect(projectContents).not.toContain(runtimeBridgeAutoloadKey);
    // The other autoload must still be present
    expect(projectContents).toContain('autoload/OtherBridge="*res://addons/other/runtime_bridge.gd"');
  });
}
);
