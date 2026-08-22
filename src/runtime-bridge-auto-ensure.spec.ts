import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});
vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import { GodotServer } from './godot-server.js';
import { RuntimeControlManager } from './runtime-control-manager.js';
import { ToolHandlers } from './tool-handlers.js';

const root = path.join(process.cwd(), '.test-artifacts', 'runtime-auto-ensure');
const projectPath = path.join(root, 'project');
const projectFile = path.join(projectPath, 'project.godot');
const assetsPath = path.join(root, 'assets');
const bridgeDir = path.join(projectPath, 'addons', 'godot_mcp_runtime');
const bridgeScript = path.join(bridgeDir, 'runtime_bridge.gd');
const bridgeManifest = path.join(bridgeDir, 'bridge_manifest.json');
const packageJson = path.join(process.cwd(), 'package.json');
const autoloadLine = 'GodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"';

function createSpawnedProcess() {
  return {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    on: vi.fn(),
  };
}

async function withConnectedClient<T>(callback: (client: Client) => Promise<T>): Promise<T> {
  const server = new GodotServer();
  const client = new Client(
    { name: 'runtime-auto-ensure-test', version: '1.0.0' },
    { capabilities: {} }
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    ((server as any).server).connect(serverTransport),
  ]);

  try {
    return await callback(client);
  } finally {
    await client.close();
    await ((server as any).server).close();
  }
}

describe('RuntimeControlManager.ensureBridge', () => {
  let bridgeVersion = '';

  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(projectPath, { recursive: true });
    await mkdir(assetsPath, { recursive: true });
    await writeFile(projectFile, '[application]\nconfig/name="Runtime Auto Ensure"\n');
    bridgeVersion = JSON.parse(await readFile(packageJson, 'utf8')).version as string;
    await writeFile(
      path.join(assetsPath, 'runtime_bridge_manifest.json'),
      JSON.stringify({ version: bridgeVersion })
    );
    await writeFile(
      path.join(assetsPath, 'runtime_bridge.gd'),
      `extends Node\nconst BRIDGE_VERSION := "${bridgeVersion}"\n`
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('installs a missing bridge and reports installed', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: assetsPath });

    const result = await manager.ensureBridge(projectPath);

    expect(result).toEqual({
      installed: true,
      version: bridgeVersion,
      compatible: true,
      action: 'installed',
    });
    await expect(readFile(projectFile, 'utf8')).resolves.toContain(autoloadLine);
  });

  it('updates a stale bridge and reports updated', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: assetsPath });
    await manager.ensureBridge(projectPath);
    await writeFile(bridgeManifest, JSON.stringify({ version: '0.0.1-stale' }));
    await writeFile(bridgeScript, 'stale bridge');

    const result = await manager.ensureBridge(projectPath);

    expect(result).toEqual({
      installed: true,
      version: bridgeVersion,
      compatible: true,
      action: 'updated',
    });
    await expect(readFile(bridgeScript, 'utf8')).resolves.toContain(bridgeVersion);
  });

  it('repairs a corrupted bridge script even when the manifest version is current', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: assetsPath });
    await manager.ensureBridge(projectPath);
    await writeFile(bridgeScript, 'corrupted bridge script');

    const result = await manager.ensureBridge(projectPath);

    expect(result).toEqual({
      installed: true,
      version: bridgeVersion,
      compatible: true,
      action: 'updated',
    });
    const managedScript = await readFile(path.join(assetsPath, 'runtime_bridge.gd'), 'utf8');
    await expect(readFile(bridgeScript, 'utf8')).resolves.toBe(managedScript);
    await expect(manager.getBridgeStatus(projectPath)).resolves.toEqual({
      installed: true,
      version: bridgeVersion,
      compatible: true,
    });
  });

  it('treats CRLF-only differences as compatible without rewriting the bridge', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: assetsPath });
    await manager.ensureBridge(projectPath);
    const managedScript = await readFile(path.join(assetsPath, 'runtime_bridge.gd'), 'utf8');
    const crlfScript = managedScript.replace(/\n/g, '\r\n');
    await writeFile(bridgeScript, crlfScript);

    const result = await manager.ensureBridge(projectPath);

    expect(result.action).toBe('unchanged');
    await expect(readFile(bridgeScript, 'utf8')).resolves.toBe(crlfScript);
  });

  it('does not rewrite an already compatible bridge', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: assetsPath });
    await manager.ensureBridge(projectPath);
    const scriptBefore = await readFile(bridgeScript, 'utf8');
    const projectBefore = await readFile(projectFile, 'utf8');

    const result = await manager.ensureBridge(projectPath);

    expect(result.action).toBe('unchanged');
    await expect(readFile(bridgeScript, 'utf8')).resolves.toBe(scriptBefore);
    await expect(readFile(projectFile, 'utf8')).resolves.toBe(projectBefore);
  });

  it('rejects a write that does not produce a compatible bridge', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: assetsPath });
    vi.spyOn(manager as any, 'writeBridge').mockResolvedValue({
      installed: true,
      version: bridgeVersion,
      compatible: false,
    });

    await expect(manager.ensureBridge(projectPath)).rejects.toThrow(
      'Runtime bridge preparation did not produce a compatible managed bridge.'
    );
  });

  it('preserves the friendly missing managed-script diagnostic from status checks', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: assetsPath });
    await manager.ensureBridge(projectPath);
    await rm(path.join(assetsPath, 'runtime_bridge.gd'));
    const freshManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: assetsPath });

    await expect(freshManager.getBridgeStatus(projectPath)).rejects.toThrow(
      'Generated runtime bridge script is missing:'
    );
  });
});

describe('ToolHandlers runtime bridge auto-ensure', () => {
  beforeEach(async () => {
    await rm(root, { recursive: true, force: true });
    await mkdir(projectPath, { recursive: true });
    await writeFile(projectFile, '[application]\nconfig/name="Runtime Auto Ensure"\n');
    spawnMock.mockReset();
    spawnMock.mockReturnValue(createSpawnedProcess());
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function createHandlers(runtimeManager: Record<string, unknown>) {
    return new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );
  }

  it('ensures the bridge before starting a controlled runtime session', async () => {
    const runtimeManager = {
      ensureBridge: vi.fn().mockResolvedValue({
        installed: true,
        version: '0.1.4',
        compatible: true,
        action: 'installed',
      }),
      startSession: vi.fn().mockResolvedValue({
        projectPath,
        port: 4100,
        token: 'token-1',
        sessionId: 'session-1',
      }),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = createHandlers(runtimeManager);

    const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).toContain(
      'Runtime control enabled; bridge installed (addons/godot_mcp_runtime/runtime_bridge.gd; project.godot [autoload]).'
    );
    expect(runtimeManager.ensureBridge).toHaveBeenCalledWith(projectPath);
    expect(runtimeManager.ensureBridge.mock.invocationCallOrder[0])
      .toBeLessThan(runtimeManager.startSession.mock.invocationCallOrder[0]);
  });

  it('keeps an existing process running when bridge preparation fails', async () => {
    const runtimeManager = {
      ensureBridge: vi.fn().mockRejectedValue(new Error('EACCES: permission denied')),
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = createHandlers(runtimeManager);

    await handlers.handleRunProject({ projectPath });
    const firstProcess = spawnMock.mock.results[0].value;

    const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to prepare runtime bridge: EACCES: permission denied');
    expect(result.content[0].text).toContain('Ensure the project directory and project.godot are writable');
    expect(result.content[0].text).toContain('Use ensure_runtime_bridge');
    expect(firstProcess.kill).not.toHaveBeenCalled();
    expect(runtimeManager.startSession).not.toHaveBeenCalled();
    expect(runtimeManager.stopSession).not.toHaveBeenCalled();
    expect((handlers as any).activeProcess?.process).toBe(firstProcess);
  });

  it('does not touch the bridge for a normal launch', async () => {
    const runtimeManager = {
      ensureBridge: vi.fn(),
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = createHandlers(runtimeManager);

    const result = await handlers.handleRunProject({ projectPath });

    expect(result.isError).not.toBe(true);
    expect(result.content[0].text).not.toContain('Runtime control enabled');
    expect(runtimeManager.ensureBridge).not.toHaveBeenCalled();
    expect(runtimeManager.startSession).not.toHaveBeenCalled();
  });
});

describe('GodotServer runtime bridge tool surface', () => {
  it('exposes ensure/status/uninstall without install/update aliases', async () => {
    await withConnectedClient(async (client) => {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);

      expect(names).toEqual(expect.arrayContaining([
        'ensure_runtime_bridge',
        'get_runtime_bridge_status',
        'uninstall_runtime_bridge',
      ]));
      expect(names).not.toContain('install_runtime_bridge');
      expect(names).not.toContain('update_runtime_bridge');
    });
  });
});
