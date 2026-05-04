import { PassThrough } from 'node:stream';
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
