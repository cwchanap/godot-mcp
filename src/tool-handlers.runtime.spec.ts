import { PassThrough } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

const { existsSyncMock, execFileMock, spawnMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  execFileMock: vi.fn(),
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
  execFile: execFileMock,
  spawn: spawnMock,
}));

import { GodotServer } from './godot-server.js';
import { ToolHandlers } from './tool-handlers.js';
import { OperationExecutor } from './operation-executor.js';
import { createOnePixelPng } from './test-helpers/png-fixture.js';
import type { RuntimeBridgeManager } from './types.js';

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

describe('GodotServer metadata', () => {
  it('reports the package version during initialization', async () => {
    const server = new GodotServer();

    await withConnectedClient(server, async (client) => {
      expect(client.getServerVersion()).toEqual({
        name: 'godot-mcp',
        version: '0.1.4',
      });
    });
  });
});

describe('ToolHandlers runtime launch plumbing', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    existsSyncMock.mockReturnValue(true);
    execFileMock.mockReset();
    execFileMock.mockImplementation((_file: string, _args: string[], arg3?: unknown, arg4?: unknown) => {
      const callback = typeof arg3 === 'function' ? arg3 : (typeof arg4 === 'function' ? arg4 : undefined);
      callback?.(null, 'Godot 4.4.0', '');
    });
    spawnMock.mockReset();
    spawnMock.mockReturnValue(createSpawnedProcess());
  });

  it('requires cleanup in the runtime manager contract', () => {
    expectTypeOf<RuntimeBridgeManager>().toHaveProperty('cleanup');
  });

  it('starts runtime control only when runtimeControl is true', async () => {
    const runtimeManager = {
      startSession: vi.fn().mockResolvedValue({
        port: 4100,
        token: 'token-1',
        sessionId: 'session-1',
      }),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      ensureBridge: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true, action: 'unchanged' }),
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
      cleanup: vi.fn().mockResolvedValue(undefined),
      ensureBridge: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true, action: 'unchanged' }),
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

  it('clears activeProcess before async stopSession so old exit handler cannot tear down new session', async () => {
    const runtimeManager = {
      startSession: vi.fn().mockResolvedValue({
        port: 4100,
        token: 'token-2',
        sessionId: 'session-2',
      }),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
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
      cleanup: vi.fn().mockResolvedValue(undefined),
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

  it('tolerates stopSession rejection during stop_project with no active process', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockRejectedValue(new Error('bridge teardown failed')),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );
    const result = await handlers.handleStopProject();
    expect(runtimeManager.stopSession).toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/Runtime session torn down/);
  });

  it('tolerates stopSession rejection during stop_project with active process', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockRejectedValue(new Error('bridge teardown failed')),
      cleanup: vi.fn().mockResolvedValue(undefined),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );
    await handlers.handleRunProject({ projectPath });
    const result = await handlers.handleStopProject();
    expect(runtimeManager.stopSession).toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/Godot project stopped/);
    expect((handlers as any).activeProcess).toBeNull();
  });

  it('tolerates stopSession rejection during run_project restart', async () => {
    const runtimeManager = {
      startSession: vi.fn().mockResolvedValue({
        port: 4100,
        token: 'token-2',
        sessionId: 'session-2',
      }),
      stopSession: vi.fn().mockRejectedValue(new Error('bridge teardown failed')),
      cleanup: vi.fn().mockResolvedValue(undefined),
      ensureBridge: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true, action: 'unchanged' }),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    // First launch
    await handlers.handleRunProject({ projectPath });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    const firstProcess = spawnMock.mock.results[0].value;

    // Second launch: stopSession rejects but should not prevent the new launch
    const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });
    expect(firstProcess.kill).toHaveBeenCalled();
    expect(runtimeManager.stopSession).toHaveBeenCalled();
    expect(result.content[0].text).toMatch(/Godot project started/);
  });

  it('kills the Godot process before awaiting stopSession during cleanup', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
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
    runtimeManager.cleanup.mockImplementation(async () => {
      stopOrder.push('cleanup');
    });

    await handlers.cleanup();

    // Process should be killed before the manager performs shutdown cleanup.
    expect(stopOrder).toEqual(['kill', 'cleanup']);
    expect(runtimeManager.cleanup).toHaveBeenCalled();
    expect(runtimeManager.stopSession).not.toHaveBeenCalled();
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
      cleanup: vi.fn().mockResolvedValue(undefined),
      ensureBridge: vi.fn().mockResolvedValue({ installed: true, version: '1.0.0', compatible: true, action: 'unchanged' }),
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

  it('does not call stopSession in the catch path when the session was not started by this invocation', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      ensureBridge: vi.fn().mockRejectedValue(new Error('EACCES: permission denied')),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      { normalizeParameters: (args: unknown) => args },
      runtimeManager
    );

    // First launch without runtime control to create an active process
    await handlers.handleRunProject({ projectPath });

    // Second launch with runtime control: getBridgeStatus throws before
    // startSession is called — the catch path must NOT tear down the session.
    const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('EACCES');
    expect(runtimeManager.startSession).not.toHaveBeenCalled();
    expect(runtimeManager.stopSession).not.toHaveBeenCalled();
  });
});

describe('GodotServer runtime bridge management tools', () => {
  it('registers consolidated runtime bridge management tools', async () => {
    const server = new GodotServer();

    const tools = await listTools(server);
    const names = tools.map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining([
      'ensure_runtime_bridge',
      'get_runtime_bridge_status',
      'uninstall_runtime_bridge',
    ]));
    expect(names).not.toContain('install_runtime_bridge');
    expect(names).not.toContain('update_runtime_bridge');
  });

  it('delegates consolidated runtime bridge management tool calls to tool handlers', async () => {
    const server = new GodotServer();
    const originalToolHandlers = (server as any).toolHandlers;
    const ensureResponse = { content: [{ type: 'text' as const, text: '{"installed":true,"compatible":true,"action":"unchanged"}' }] };
    const statusResponse = { content: [{ type: 'text' as const, text: '{"installed":true,"compatible":true}' }] };
    const uninstallResponse = { content: [{ type: 'text' as const, text: '{"message":"removed"}' }] };
    const handleEnsureRuntimeBridge = vi.fn().mockResolvedValue(ensureResponse);
    const handleGetRuntimeBridgeStatus = vi.fn().mockResolvedValue(statusResponse);
    const handleUninstallRuntimeBridge = vi.fn().mockResolvedValue(uninstallResponse);

    (server as any).toolHandlers = {
      cleanup: originalToolHandlers.cleanup.bind(originalToolHandlers),
      handleEnsureRuntimeBridge,
      handleGetRuntimeBridgeStatus,
      handleUninstallRuntimeBridge,
    };

    await withConnectedClient(server, async (client) => {
      await expect(client.callTool({
        name: 'ensure_runtime_bridge',
        arguments: { projectPath },
      })).resolves.toEqual(ensureResponse);
      await expect(client.callTool({
        name: 'get_runtime_bridge_status',
        arguments: { projectPath },
      })).resolves.toEqual(statusResponse);
      await expect(client.callTool({
        name: 'uninstall_runtime_bridge',
        arguments: { projectPath },
      })).resolves.toEqual(uninstallResponse);
    });

    expect(handleEnsureRuntimeBridge).toHaveBeenCalledWith({ projectPath });
    expect(handleGetRuntimeBridgeStatus).toHaveBeenCalledWith({ projectPath });
    expect(handleUninstallRuntimeBridge).toHaveBeenCalledWith({ projectPath });
  });
});

describe('ToolHandlers runtime command delegation', () => {
  it('delegates get_runtime_state, find_node, change_scene, and invoke_node_action to the runtime manager', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
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

  it('returns exact metadata text followed by native MCP image content', async () => {
    const png = createOnePixelPng();
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn().mockResolvedValue({
        data: png.toString('base64'),
        mimeType: 'image/png',
        width: 1,
        height: 1,
        byteLength: png.length,
        savedPath: null,
        saveError: 'disk full',
      }),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      new (OperationExecutor as any)('unused'),
      runtimeManager
    );

    const result = await handlers.handleCaptureScreenshot({ save_to: 'project' });

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            width: 1,
            height: 1,
            mimeType: 'image/png',
            byteLength: png.length,
            savedPath: null,
            saveError: 'disk full',
          }, null, 2),
        },
        { type: 'image', data: png.toString('base64'), mimeType: 'image/png' },
      ],
    });
    expect(result.content[0].text).not.toContain(png.toString('base64'));
    expect(runtimeManager.captureScreenshot).toHaveBeenCalledWith('project');
  });

  it('maps screenshot connection failures to the standard error response without an image', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn().mockRejectedValue(new Error('Runtime bridge not connected.')),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      new (OperationExecutor as any)('unused'),
      runtimeManager
    );

    const result = await handlers.handleCaptureScreenshot({});

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: 'Failed to capture runtime screenshot: Runtime bridge not connected.',
        },
        {
          type: 'text',
          text: 'Possible solutions:\n- Start the project with runtime control enabled\n- Reconnect or update the runtime bridge if the running project restarted',
        },
      ],
      isError: true,
    });
    expect(result.content).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'image' }),
    ]));
  });

  it('rejects unsupported screenshot save destinations before dispatch', async () => {
    const runtimeManager = {
      startSession: vi.fn(),
      stopSession: vi.fn().mockResolvedValue(undefined),
      cleanup: vi.fn().mockResolvedValue(undefined),
      captureScreenshot: vi.fn(),
    };
    const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
      { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
      new (OperationExecutor as any)('unused'),
      runtimeManager
    );

    const result = await handlers.handleCaptureScreenshot({ saveTo: 'absolute' });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Screenshot save destination must be "temporary" or "project".');
    expect(runtimeManager.captureScreenshot).not.toHaveBeenCalled();
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
      expect.objectContaining({
        name: 'capture_screenshot',
        description: 'Capture the latest available rendered frame from the active running Godot game',
        inputSchema: expect.objectContaining({
          properties: expect.objectContaining({
            saveTo: expect.objectContaining({ enum: ['temporary', 'project'] }),
          }),
          required: [],
        }),
      }),
    ]));
  });

  it('delegates runtime command tool calls to tool handlers', async () => {
    const server = new GodotServer();
    const originalToolHandlers = (server as any).toolHandlers;
    const png = createOnePixelPng();
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
    const captureScreenshotResponse = {
      content: [
        { type: 'text' as const, text: '{"width":1}' },
        { type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' as const },
      ],
    };
    const handleCaptureScreenshot = vi.fn().mockResolvedValue(captureScreenshotResponse);

    (server as any).toolHandlers = {
      cleanup: originalToolHandlers.cleanup.bind(originalToolHandlers),
      handleGetRuntimeState,
      handleFindNode,
      handleChangeScene,
      handleInvokeNodeAction,
      handleCaptureScreenshot,
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
      await expect(client.callTool({
        name: 'capture_screenshot',
        arguments: { saveTo: 'temporary' },
      })).resolves.toEqual(captureScreenshotResponse);
    });

    expect(handleGetRuntimeState).toHaveBeenCalledWith();
    expect(handleFindNode).toHaveBeenCalledWith({ nodePath: 'root/Menu/StartButton' });
    expect(handleChangeScene).toHaveBeenCalledWith({ scenePath: 'res://Other.tscn' });
    expect(handleInvokeNodeAction).toHaveBeenCalledWith({
      nodePath: 'root/Menu/StartButton',
      action: 'press',
    });
    expect(handleCaptureScreenshot).toHaveBeenCalledWith({ saveTo: 'temporary' });
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
        cleanup: vi.fn().mockResolvedValue(undefined),
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
