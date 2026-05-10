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
      getBridgeStatus: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true }),
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
      getBridgeStatus: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true }),
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

  it('returns an error when runtimeControl is true but bridge is not installed', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      getBridgeStatus: vi.fn().mockResolvedValue({ installed: false, version: null, compatible: false }),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not installed');
    expect(runtimeManager.startSession).not.toHaveBeenCalled();
  });

  it('returns an error when runtimeControl is true but bridge is incompatible', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      getBridgeStatus: vi.fn().mockResolvedValue({ installed: true, version: '0.0.1-stale', compatible: false }),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not compatible');
    expect(runtimeManager.startSession).not.toHaveBeenCalled();
  });

  it('does not kill the existing process when bridge preflight fails', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      getBridgeStatus: vi.fn().mockResolvedValue({ installed: false, version: null, compatible: false }),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    // First launch: create an initial active process (no runtime control)
    await handlers.handleRunProject({ projectPath });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const firstProcess = spawnMock.mock.results[0].value;

    // Second launch with runtimeControl but bridge not installed:
    // should return error without killing the first process
    const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not installed');
    expect(firstProcess.kill).not.toHaveBeenCalled();
    expect(runtimeManager.stopSession).not.toHaveBeenCalled();
    // The original process should still be tracked
    expect((handlers as any).activeProcess).not.toBeNull();
    expect((handlers as any).activeProcess.process).toBe(firstProcess);
  });

  it('clears activeProcess before async stopSession so old exit handler cannot tear down new session', async () => {
    const runtimeManager = {
      startSession: vi.fn().mockResolvedValue({
        port: 4100,
        token: 'token-2',
        sessionId: 'session-2',
      }),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    // First launch: create an initial active process
    await handlers.handleRunProject({ projectPath });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const firstProcess = spawnMock.mock.results[0].value;

    // Second launch: should clear activeProcess before async operations
    // Simulate stopSession being slow by delaying it
    let resolveStopSession: () => void;
    const stopSessionPromise = new Promise<void>((resolve) => { resolveStopSession = resolve; });
    runtimeManager.stopSession.mockReturnValueOnce(stopSessionPromise);

    const secondLaunchPromise = handlers.handleRunProject({ projectPath });

    // While stopSession is still pending, activeProcess should already be null
    // so the old process exit handler's identity check would fail
    expect((handlers as any).activeProcess).toBeNull();

    // Resolve stopSession so the second launch can proceed
    resolveStopSession!();
    await secondLaunchPromise;

    // The new process should now be active
    expect((handlers as any).activeProcess).not.toBeNull();
    expect((handlers as any).activeProcess.process).toBe(spawnMock.mock.results[1].value);
    expect(firstProcess.kill).toHaveBeenCalled();
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
    expect(result.content[0].text).toMatch(/Runtime session torn down/);
  });

  it('kills the Godot process before awaiting stopSession during cleanup', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    await handlers.handleRunProject({ projectPath });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const process = spawnMock.mock.results[0].value;

    const stopOrder: string[] = [];
    process.kill.mockImplementation(() => { stopOrder.push('kill'); });
    runtimeManager.stopSession.mockImplementation(async () => {
      stopOrder.push('stopSession');
    });

    await handlers.cleanup();

    // Process should be killed before stopSession is awaited
    expect(stopOrder).toEqual(['kill', 'stopSession']);
    expect((handlers as any).activeProcess).toBeNull();
  });

  it('does not lose the original error when stopSession throws in the catch path', async () => {
    const runtimeManager = {
      startSession: vi.fn().mockResolvedValue({
        port: 4100,
        token: 'token-1',
        sessionId: 'session-1',
      }),
      stopSession: vi.fn().mockRejectedValue(new Error('stopSession boom')),
      getBridgeStatus: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true }),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    // Force a spawn error by making spawn throw
    spawnMock.mockImplementation(() => { throw new Error('spawn ENOENT'); });

    const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('spawn ENOENT');
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

describe('ToolHandlers runtime command delegation', () => {
  it('delegates get_runtime_state, find_node, change_scene, and invoke_node_action to the runtime manager', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      getRuntimeState: vi.fn().mockReturnValue({
        connected: true,
        sessionId: 'session-1',
        scenePath: 'res://Main.tscn',
      }),
      findNode: vi.fn().mockResolvedValue({
        found: true,
        nodePath: 'root/Menu/StartButton',
      }),
      changeScene: vi.fn().mockResolvedValue({
        ok: true,
        scenePath: 'res://Other.tscn',
      }),
      invokeNodeAction: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          nodePath: 'root/Menu/StartButton',
          action: 'press',
        },
      }),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    await expect(handlers.handleGetRuntimeState()).resolves.toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({
          connected: true,
          sessionId: 'session-1',
          scenePath: 'res://Main.tscn',
        }, null, 2),
      }],
    });
    await expect(handlers.handleFindNode({ nodePath: 'root/Menu/StartButton' })).resolves.toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({
          found: true,
          nodePath: 'root/Menu/StartButton',
        }, null, 2),
      }],
    });
    await expect(handlers.handleChangeScene({ scenePath: 'res://Other.tscn' })).resolves.toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          scenePath: 'res://Other.tscn',
        }, null, 2),
      }],
    });
    await expect(handlers.handleInvokeNodeAction({
      nodePath: 'root/Menu/StartButton',
      action: 'press',
    })).resolves.toEqual({
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          result: {
            nodePath: 'root/Menu/StartButton',
            action: 'press',
          },
        }, null, 2),
      }],
    });

    expect(runtimeManager.getRuntimeState).toHaveBeenCalledTimes(1);
    expect(runtimeManager.findNode).toHaveBeenCalledWith('root/Menu/StartButton');
    expect(runtimeManager.changeScene).toHaveBeenCalledWith('res://Other.tscn');
    expect(runtimeManager.invokeNodeAction).toHaveBeenCalledWith('root/Menu/StartButton', 'press');
  });
});

describe('GodotServer runtime command tools', () => {
  it('registers runtime state and scene tools', async () => {
    const server = new GodotServer();

    const tools = await listTools(server);

    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'get_runtime_state' }),
      expect.objectContaining({ name: 'find_node' }),
      expect.objectContaining({
        name: 'change_scene',
        description: 'Request a scene transition in the running Godot project',
        inputSchema: expect.objectContaining({
          required: ['scenePath'],
        }),
      }),
      expect.objectContaining({
        name: 'invoke_node_action',
        description: 'Invoke an allowlisted action on a node in the running Godot project',
        inputSchema: expect.objectContaining({
          required: ['nodePath', 'action'],
        }),
      }),
    ]));
  });

  it('delegates runtime command tool calls to tool handlers', async () => {
    const server = new GodotServer();
    const originalToolHandlers = (server as any).toolHandlers;
    const getRuntimeStateResponse = {
      content: [{ type: 'text' as const, text: '{"connected":true,"sessionId":"session-1","scenePath":"res://Main.tscn"}' }],
    };
    const findNodeResponse = {
      content: [{ type: 'text' as const, text: '{"found":true,"nodePath":"root/Menu/StartButton"}' }],
    };
    const changeSceneResponse = {
      content: [{ type: 'text' as const, text: '{"ok":true,"scenePath":"res://Other.tscn"}' }],
    };
    const invokeNodeActionResponse = {
      content: [{ type: 'text' as const, text: '{"ok":true,"result":{"nodePath":"root/Menu/StartButton","action":"press"}}' }],
    };
    const handleGetRuntimeState = vi.fn().mockResolvedValue(getRuntimeStateResponse);
    const handleFindNode = vi.fn().mockResolvedValue(findNodeResponse);
    const handleChangeScene = vi.fn().mockResolvedValue(changeSceneResponse);
    const handleInvokeNodeAction = vi.fn().mockResolvedValue(invokeNodeActionResponse);

    (server as any).toolHandlers = {
      cleanup: originalToolHandlers.cleanup.bind(originalToolHandlers),
      handleGetRuntimeState,
      handleFindNode,
      handleChangeScene,
      handleInvokeNodeAction,
    };

    await withConnectedClient(server, async (client) => {
      await expect(client.callTool({
        name: 'get_runtime_state',
        arguments: {},
      })).resolves.toEqual(getRuntimeStateResponse);
      await expect(client.callTool({
        name: 'find_node',
        arguments: { nodePath: 'root/Menu/StartButton' },
      })).resolves.toEqual(findNodeResponse);
      await expect(client.callTool({
        name: 'change_scene',
        arguments: { scenePath: 'res://Other.tscn' },
      })).resolves.toEqual(changeSceneResponse);
      await expect(client.callTool({
        name: 'invoke_node_action',
        arguments: {
          nodePath: 'root/Menu/StartButton',
          action: 'press',
        },
      })).resolves.toEqual(invokeNodeActionResponse);
    });

    expect(handleGetRuntimeState).toHaveBeenCalledWith();
    expect(handleFindNode).toHaveBeenCalledWith({ nodePath: 'root/Menu/StartButton' });
    expect(handleChangeScene).toHaveBeenCalledWith({ scenePath: 'res://Other.tscn' });
    expect(handleInvokeNodeAction).toHaveBeenCalledWith({
      nodePath: 'root/Menu/StartButton',
      action: 'press',
    });
  });
});

describe('ToolHandlers runtime bridge project validation', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(false);
    spawnMock.mockReset();
  });

  it.each([
    ['handleInstallRuntimeBridge', 'installBridge', 'Failed to install runtime bridge'],
    ['handleGetRuntimeBridgeStatus', 'getBridgeStatus', 'Failed to get runtime bridge status'],
    ['handleUpdateRuntimeBridge', 'updateBridge', 'Failed to update runtime bridge'],
    ['handleUninstallRuntimeBridge', 'uninstallBridge', 'Failed to uninstall runtime bridge'],
  ] as const)(
    'rejects non-Godot projects in %s',
    async (handlerName, managerMethodName, unexpectedMessage) => {
      const runtimeManager = {
        startSession: vi.fn(),
        stopSession: vi.fn().mockResolvedValue(undefined),
        installBridge: vi.fn(),
        getBridgeStatus: vi.fn(),
        updateBridge: vi.fn(),
        uninstallBridge: vi.fn(),
      };
      const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
        { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
        { normalizeParameters: (args: unknown) => args },
        runtimeManager
      );

      const result = await handlers[handlerName]({ projectPath });

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: `Not a valid Godot project: ${projectPath}`,
          },
          {
            type: 'text',
            text: 'Possible solutions:\n- Ensure the path points to a directory containing a project.godot file\n- Use list_projects to find valid Godot projects',
          },
        ],
        isError: true,
      });
      expect(runtimeManager[managerMethodName]).not.toHaveBeenCalled();
      expect(result.content[0].text).not.toContain(unexpectedMessage);
    }
  );
});
