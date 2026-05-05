import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { Socket, createConnection } from 'node:net';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const socketBuffers = new WeakMap<Socket, string>();

async function connectBridgeClient(port: number): Promise<Socket> {
  const socket = createConnection({ host: '127.0.0.1', port });
  socket.setEncoding('utf8');
  await once(socket, 'connect');
  return socket;
}

async function closeBridgeClient(socket: Socket): Promise<void> {
  if (socket.destroyed) {
    return;
  }

  socket.end();
  await once(socket, 'close').catch(() => undefined);
}

async function writeJsonLine(socket: Socket, message: Record<string, unknown>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    socket.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readJsonLine(socket: Socket): Promise<Record<string, unknown>> {
  const consumeBufferedLine = (): Record<string, unknown> | null => {
    const buffer = socketBuffers.get(socket) ?? '';
    const newlineIndex = buffer.indexOf('\n');

    if (newlineIndex === -1) {
      return null;
    }

    const line = buffer.slice(0, newlineIndex).trim();
    socketBuffers.set(socket, buffer.slice(newlineIndex + 1));
    return JSON.parse(line) as Record<string, unknown>;
  };

  const bufferedLine = consumeBufferedLine();
  if (bufferedLine) {
    return bufferedLine;
  }

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const onData = (chunk: string | Buffer) => {
      const nextBuffer = `${socketBuffers.get(socket) ?? ''}${chunk.toString()}`;
      socketBuffers.set(socket, nextBuffer);
      const parsed = consumeBufferedLine();
      if (!parsed) {
        return;
      }

      cleanup();
      resolve(parsed);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onClose = () => {
      cleanup();
      reject(new Error('Socket closed before a complete JSON message was received.'));
    };

    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };

    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

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
  const sendCommandMock = vi.fn();

  beforeEach(() => {
    sendCommandMock.mockReset();
    manager = new RuntimeControlManager({
      runtimeBridgeAssetsDir: generatedAssetsPath,
      sendCommand: sendCommandMock,
    });
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

  it('starts a real local runtime session with a listening port and token', async () => {
    const realManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const relativeProjectPath = path.relative(process.cwd(), projectPath);
    const session = await realManager.startSession(relativeProjectPath);
    const socket = await connectBridgeClient(session.port);

    try {
      expect(session.port).toBeGreaterThan(0);
      expect(session.token).not.toHaveLength(0);
      expect(session.sessionId).toMatch(/^session-/);
      expect(realManager.getRuntimeState()).toEqual({
        connected: false,
        sessionId: session.sessionId,
        scenePath: null,
      });
    } finally {
      await closeBridgeClient(socket);
      await realManager.stopSession();
    }
  });

  it('marks the session connected after a successful hello handshake with normalized project paths', async () => {
    const realManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const relativeProjectPath = path.relative(process.cwd(), projectPath);
    const session = await realManager.startSession(relativeProjectPath);
    const socket = await connectBridgeClient(session.port);

    try {
      await writeJsonLine(socket, {
        command: 'hello',
        token: session.token,
        version: bridgeVersion,
        sessionId: session.sessionId,
        projectPath: `${projectPath}${path.sep}`,
        scenePath: 'res://Main.tscn',
      });

      await expect(readJsonLine(socket)).resolves.toMatchObject({ ok: true });
      await vi.waitFor(() => {
        expect(realManager.getRuntimeState()).toEqual({
          connected: true,
          sessionId: session.sessionId,
          scenePath: 'res://Main.tscn',
        });
      });
    } finally {
      await closeBridgeClient(socket);
      await realManager.stopSession();
    }
  });

  it('rejects hello handshakes for a different project path after normalization', async () => {
    const realManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const relativeProjectPath = path.relative(process.cwd(), projectPath);
    const session = await realManager.startSession(relativeProjectPath);
    const socket = await connectBridgeClient(session.port);

    try {
      await writeJsonLine(socket, {
        command: 'hello',
        token: session.token,
        version: bridgeVersion,
        sessionId: session.sessionId,
        projectPath: path.join(path.dirname(projectPath), 'other-project'),
      });

      await expect(readJsonLine(socket)).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/wrong project/i),
      });
      expect(realManager.getRuntimeState()).toEqual({
        connected: false,
        sessionId: session.sessionId,
        scenePath: null,
      });
    } finally {
      await closeBridgeClient(socket);
      await realManager.stopSession();
    }
  });

  it('keeps the session in a pre-connect state after a rejected hello handshake', async () => {
    const realManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const session = await realManager.startSession(projectPath);
    const socket = await connectBridgeClient(session.port);

    try {
      await writeJsonLine(socket, {
        command: 'hello',
        token: session.token,
        version: bridgeVersion,
        sessionId: session.sessionId,
        projectPath: `${projectPath}-other`,
      });

      await expect(readJsonLine(socket)).resolves.toMatchObject({
        ok: false,
        error: expect.stringMatching(/wrong project/i),
      });
      await once(socket, 'close');

      await expect(realManager.changeScene('res://Other.tscn')).rejects.toThrow(/not connected/i);
    } finally {
      await closeBridgeClient(socket);
      await realManager.stopSession();
    }
  });

  it('routes find_node requests over the real socket transport', async () => {
    const realManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const session = await realManager.startSession(projectPath);
    const socket = await connectBridgeClient(session.port);

    try {
      await writeJsonLine(socket, {
        command: 'hello',
        token: session.token,
        version: bridgeVersion,
        sessionId: session.sessionId,
        projectPath,
        scenePath: 'res://Main.tscn',
      });
      await readJsonLine(socket);

      const findNodePromise = realManager.findNode('root/Menu/StartButton');
      const request = await readJsonLine(socket);
      expect(request).toMatchObject({
        command: 'find_node',
        nodePath: 'root/Menu/StartButton',
        requestId: expect.any(String),
      });
      await writeJsonLine(socket, {
        requestId: request.requestId,
        ok: true,
        result: {
          found: true,
          nodePath: 'root/Menu/StartButton',
          nodeType: 'Button',
        },
      });

      await expect(findNodePromise).resolves.toEqual({
        ok: true,
        result: {
          found: true,
          nodePath: 'root/Menu/StartButton',
          nodeType: 'Button',
        },
      });
    } finally {
      await closeBridgeClient(socket);
      await realManager.stopSession();
    }
  });

  it('routes change_scene requests over the real socket transport', async () => {
    const realManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const session = await realManager.startSession(projectPath);
    const socket = await connectBridgeClient(session.port);

    try {
      await writeJsonLine(socket, {
        command: 'hello',
        token: session.token,
        version: bridgeVersion,
        sessionId: session.sessionId,
        projectPath,
        scenePath: 'res://Main.tscn',
      });
      await readJsonLine(socket);

      const changeScenePromise = realManager.changeScene('res://Other.tscn');
      const request = await readJsonLine(socket);
      expect(request).toMatchObject({
        command: 'change_scene',
        scenePath: 'res://Other.tscn',
        requestId: expect.any(String),
      });
      await writeJsonLine(socket, {
        requestId: request.requestId,
        ok: true,
        result: {
          scenePath: 'res://Other.tscn',
        },
      });

      await expect(changeScenePromise).resolves.toEqual({
        ok: true,
        result: {
          scenePath: 'res://Other.tscn',
        },
      });
      expect(realManager.getRuntimeState()).toEqual({
        connected: true,
        sessionId: session.sessionId,
        scenePath: 'res://Other.tscn',
      });
    } finally {
      await closeBridgeClient(socket);
      await realManager.stopSession();
    }
  });

  it('does not update runtime state when change_scene reports failure', async () => {
    sendCommandMock.mockResolvedValue({
      ok: false,
      error: 'Scene load failed',
    });
    manager.setConnectedSessionForTest({
      sessionId: 'session-1',
      scenePath: 'res://Main.tscn',
    });

    await expect(manager.changeScene('res://Other.tscn')).resolves.toEqual({
      ok: false,
      error: 'Scene load failed',
    });
    expect(manager.getRuntimeState()).toEqual({
      connected: true,
      sessionId: 'session-1',
      scenePath: 'res://Main.tscn',
    });
  });

  it('routes invoke_node_action requests over the real socket transport', async () => {
    const realManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const session = await realManager.startSession(projectPath);
    const socket = await connectBridgeClient(session.port);

    try {
      await writeJsonLine(socket, {
        command: 'hello',
        token: session.token,
        version: bridgeVersion,
        sessionId: session.sessionId,
        projectPath,
        scenePath: 'res://Main.tscn',
      });
      await readJsonLine(socket);

      const actionPromise = realManager.invokeNodeAction('root/Menu/StartButton', 'press');
      const findRequest = await readJsonLine(socket);
      expect(findRequest).toMatchObject({
        command: 'find_node',
        nodePath: 'root/Menu/StartButton',
        requestId: expect.any(String),
      });
      await writeJsonLine(socket, {
        requestId: findRequest.requestId,
        ok: true,
        result: {
          found: true,
          nodePath: 'root/Menu/StartButton',
          nodeType: 'Button',
        },
      });

      const actionRequest = await readJsonLine(socket);
      expect(actionRequest).toMatchObject({
        command: 'invoke_node_action',
        nodePath: 'root/Menu/StartButton',
        action: 'press',
        requestId: expect.any(String),
      });
      await writeJsonLine(socket, {
        requestId: actionRequest.requestId,
        ok: true,
        result: {
          nodePath: 'root/Menu/StartButton',
          action: 'press',
        },
      });

      await expect(actionPromise).resolves.toEqual({
        ok: true,
        result: {
          nodePath: 'root/Menu/StartButton',
          action: 'press',
        },
      });
    } finally {
      await closeBridgeClient(socket);
      await realManager.stopSession();
    }
  });

  it('returns a disconnected error when change_scene is called without a connected bridge', async () => {
    await expect(manager.changeScene('res://Main.tscn')).rejects.toThrow(/not connected/i);
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('routes find_node to the active bridge session', async () => {
    sendCommandMock.mockResolvedValue({ nodePath: 'root/Menu/StartButton', found: true });
    manager.setConnectedSessionForTest({
      sessionId: 'session-1',
      scenePath: 'res://Main.tscn',
    });

    await manager.findNode('root/Menu/StartButton');

    expect(sendCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      command: 'find_node',
      nodePath: 'root/Menu/StartButton',
    }));
  });

  it('rejects press actions for resolved non-button node types before dispatch', async () => {
    sendCommandMock.mockResolvedValue({
      ok: true,
      result: {
        found: true,
        nodePath: 'root/Menu/StartButton',
        nodeType: 'Label',
      },
    });
    manager.setConnectedSessionForTest({
      sessionId: 'session-1',
      scenePath: 'res://Main.tscn',
    });

    await expect(manager.invokeNodeAction('root/Menu/StartButton', 'press')).rejects.toThrow(/unsupported/i);
    expect(sendCommandMock).toHaveBeenCalledTimes(1);
    expect(sendCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      command: 'find_node',
      nodePath: 'root/Menu/StartButton',
    }));
  });

  it('routes button press actions to the connected bridge session', async () => {
    sendCommandMock
      .mockResolvedValueOnce({
        ok: true,
        result: {
          found: true,
          nodePath: 'root/Menu/StartButton',
          nodeType: 'Button',
        },
      })
      .mockResolvedValueOnce({
      ok: true,
      result: {
        nodePath: 'root/Menu/StartButton',
        action: 'press',
      },
      });
    manager.setConnectedSessionForTest({
      sessionId: 'session-1',
      scenePath: 'res://Main.tscn',
    });

    await manager.invokeNodeAction('root/Menu/StartButton', 'press');

    expect(sendCommandMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      command: 'find_node',
      nodePath: 'root/Menu/StartButton',
    }));
    expect(sendCommandMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: 'invoke_node_action',
      nodePath: 'root/Menu/StartButton',
      action: 'press',
    }));
  });

  it('rejects handshakes that present the wrong token', async () => {
    const session = await manager.startSession(projectPath);

    await expect(manager.acceptHandshake({
      token: 'wrong-token',
      version: bridgeVersion,
      sessionId: session.sessionId,
      projectPath,
    })).rejects.toThrow(/invalid token/i);
  });

  it('rejects handshakes with a bridge version mismatch', async () => {
    const session = await manager.startSession(projectPath);

    await expect(manager.acceptHandshake({
      token: session.token,
      version: '0.0.9',
      sessionId: session.sessionId,
      projectPath,
    })).rejects.toThrow(/version mismatch/i);
  });

  it('rejects handshakes for the wrong project path', async () => {
    const session = await manager.startSession(projectPath);

    await expect(manager.acceptHandshake({
      token: session.token,
      version: bridgeVersion,
      sessionId: session.sessionId,
      projectPath: `${projectPath}-other`,
    })).rejects.toThrow(/wrong project/i);
  });

  it('returns a reconnect-required error after the active socket disconnects', async () => {
    manager.setConnectedSessionForTest({
      sessionId: 'session-1',
      scenePath: 'res://Main.tscn',
    });
    manager.setDisconnectedForTest();

    await expect(manager.findNode('root/Menu/StartButton')).rejects.toThrow(/reconnect-required/i);
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('marks the active session disconnected when command transport fails', async () => {
    sendCommandMock.mockRejectedValue(new Error('socket closed'));
    manager.setConnectedSessionForTest({
      sessionId: 'session-1',
      scenePath: 'res://Main.tscn',
    });

    await expect(manager.findNode('root/Menu/StartButton')).rejects.toThrow(/reconnect-required/i);
    expect(manager.getRuntimeState()).toEqual({
      connected: false,
      sessionId: 'session-1',
      scenePath: 'res://Main.tscn',
    });

    await expect(manager.changeScene('res://Other.tscn')).rejects.toThrow(/reconnect-required/i);
    expect(sendCommandMock).toHaveBeenCalledTimes(1);
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
    await manager.installBridge(projectPath);
    manager.setActiveSessionForTest('session-1');

    await expect(manager.uninstallBridge(projectPath)).rejects.toThrow(/running session/i);

    await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.toContain(bridgeVersion);
    await expect(readFile(manifestPath, 'utf8')).resolves.toContain(bridgeVersion);
    await expect(readFile(projectFile, 'utf8')).resolves.toContain(runtimeBridgeAutoloadKey);
  });

  it('allows uninstalling a different project while a session is active', async () => {
    const sessionManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    const session = await sessionManager.startSession(projectPath);

    try {
      const otherProjectPath = path.join(process.cwd(), '.test-artifacts', 'other-runtime-project');
      const otherProjectFile = path.join(otherProjectPath, 'project.godot');
      const otherBridgeDir = path.join(otherProjectPath, 'addons', 'godot_mcp_runtime');

      try {
        await mkdir(otherProjectPath, { recursive: true });
        await writeFile(otherProjectFile, '[application]\nconfig/name="Other Project"\n');

        const uninstallManager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
        await uninstallManager.installBridge(otherProjectPath);

        // Should succeed because the active session is for a different project
        await uninstallManager.uninstallBridge(otherProjectPath);

        await expect(readFile(otherProjectFile, 'utf8')).resolves.not.toContain(runtimeBridgeAutoloadKey);
        await expect(rm(otherBridgeDir, { recursive: true, force: true })).resolves.toBeUndefined();
      } finally {
        await rm(otherProjectPath, { recursive: true, force: true });
      }
    } finally {
      await sessionManager.stopSession();
    }
  });

  it('removes the owned autoload entry during uninstall', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    await manager.installBridge(projectPath);

    await manager.uninstallBridge(projectPath);

    await expect(readFile(projectFile, 'utf8')).resolves.not.toContain(runtimeBridgeAutoloadKey);
  });

  it('keeps bridge files intact when autoload cleanup fails during uninstall', async () => {
    const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
    await manager.installBridge(projectPath);
    await chmod(projectFile, 0o444);

    await expect(manager.uninstallBridge(projectPath)).rejects.toThrow();

    await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.toContain(bridgeVersion);
    await expect(readFile(manifestPath, 'utf8')).resolves.toContain(bridgeVersion);
    await expect(readFile(projectFile, 'utf8')).resolves.toContain(runtimeBridgeAutoloadKey);
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
