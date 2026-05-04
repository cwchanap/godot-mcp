import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock, spawnMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  spawnMock: vi.fn(),
}));

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: existsSyncMock,
  };
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
  spawn: spawnMock,
}));

import { GodotServer } from './godot-server.js';
import { ToolHandlers } from './tool-handlers.js';

const projectPath = '/workspace/project';

function createSpawnedProcess() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();

  return {
    stdout,
    stderr,
    kill: vi.fn(),
    on: vi.fn(),
  };
}

async function withConnectedClient<T>(
  server: GodotServer,
  callback: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client(
    {
      name: 'test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    }
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

async function listTools(server: GodotServer) {
  return withConnectedClient(server, async (client) => {
    const result = await client.listTools();
    return result.tools;
  });
}

describe('ToolHandlers runtime launch plumbing', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(true);
    spawnMock.mockReset();
    spawnMock.mockReturnValue(createSpawnedProcess());
  });

  it('starts runtime control only when runtimeControl is true', async () => {
    const runtimeManager = {
      startSession: vi.fn().mockResolvedValue({
        port: 4100,
        token: 'token-1',
        sessionId: 'session-1',
      }),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    await handlers.handleRunProject({ projectPath });
    expect(runtimeManager.startSession).not.toHaveBeenCalled();

    await handlers.handleRunProject({ projectPath, runtimeControl: true });
    expect(runtimeManager.startSession).toHaveBeenCalledWith(projectPath);
  });

  it('passes runtime control args after -- to Godot', async () => {
    const runtimeManager = {
      startSession: vi.fn().mockResolvedValue({
        port: 4100,
        token: 'token-1',
        sessionId: 'session-1',
      }),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    await handlers.handleRunProject({ projectPath, runtimeControl: true });

    expect(spawnMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([
        '--',
        '--godot-mcp-port',
        '4100',
        '--godot-mcp-token',
        'token-1',
        '--godot-mcp-session',
        'session-1',
      ]),
      expect.anything()
    );
  });

  it('calls stopSession even if no active Godot process', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );
    // No process started, so activeProcess is null
    const result = await handlers.handleStopProject();
    expect(runtimeManager.stopSession).toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/Runtime session cleaned up/);
  });
});

describe('GodotServer runtime bridge management tools', () => {
  it('registers runtime bridge management tools', async () => {
    const server = new GodotServer();

    const tools = await listTools(server);

    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'install_runtime_bridge' }),
      expect.objectContaining({ name: 'get_runtime_bridge_status' }),
      expect.objectContaining({ name: 'update_runtime_bridge' }),
      expect.objectContaining({ name: 'uninstall_runtime_bridge' }),
    ]));
  });

  it('delegates runtime bridge management tool calls to tool handlers', async () => {
    const server = new GodotServer();
    const originalToolHandlers = (server as any).toolHandlers;
    const installResponse = { content: [{ type: 'text' as const, text: '{"installed":true}' }] };
    const statusResponse = { content: [{ type: 'text' as const, text: '{"installed":true,"compatible":true}' }] };
    const updateResponse = { content: [{ type: 'text' as const, text: '{"installed":true,"version":"1.0.0"}' }] };
    const uninstallResponse = { content: [{ type: 'text' as const, text: '{"message":"removed"}' }] };
    const handleInstallRuntimeBridge = vi.fn().mockResolvedValue(installResponse);
    const handleGetRuntimeBridgeStatus = vi.fn().mockResolvedValue(statusResponse);
    const handleUpdateRuntimeBridge = vi.fn().mockResolvedValue(updateResponse);
    const handleUninstallRuntimeBridge = vi.fn().mockResolvedValue(uninstallResponse);

    (server as any).toolHandlers = {
      cleanup: originalToolHandlers.cleanup.bind(originalToolHandlers),
      handleInstallRuntimeBridge,
      handleGetRuntimeBridgeStatus,
      handleUpdateRuntimeBridge,
      handleUninstallRuntimeBridge,
    };

    await withConnectedClient(server, async (client) => {
      await expect(client.callTool({
        name: 'install_runtime_bridge',
        arguments: { projectPath },
      })).resolves.toEqual(installResponse);
      await expect(client.callTool({
        name: 'get_runtime_bridge_status',
        arguments: { projectPath },
      })).resolves.toEqual(statusResponse);
      await expect(client.callTool({
        name: 'update_runtime_bridge',
        arguments: { projectPath },
      })).resolves.toEqual(updateResponse);
      await expect(client.callTool({
        name: 'uninstall_runtime_bridge',
        arguments: { projectPath },
      })).resolves.toEqual(uninstallResponse);
    });

    expect(handleInstallRuntimeBridge).toHaveBeenCalledWith({ projectPath });
    expect(handleGetRuntimeBridgeStatus).toHaveBeenCalledWith({ projectPath });
    expect(handleUpdateRuntimeBridge).toHaveBeenCalledWith({ projectPath });
    expect(handleUninstallRuntimeBridge).toHaveBeenCalledWith({ projectPath });
  });
});
