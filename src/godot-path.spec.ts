import type { ChildProcess } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock, execMock } = vi.hoisted(() => {
  return {
    existsSyncMock: vi.fn(),
    execMock: vi.fn(),
  };
});

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('child_process', () => ({
  exec: execMock,
}));

import { GodotPathManager } from './godot-path.js';

const resolveExecMock = (implementation?: (command: string) => void) => {
  execMock.mockImplementation((command: string, arg2?: unknown, arg3?: unknown) => {
    const callback = typeof arg2 === 'function' ? arg2 : (typeof arg3 === 'function' ? arg3 : undefined);
    implementation?.(command);
    callback?.(null, 'Godot 4.2.0', '');
    return null as unknown as ChildProcess;
  });
};

describe('GodotPathManager', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    execMock.mockReset();
  });

  it('validates a custom Godot path and caches the result', async () => {
    existsSyncMock.mockReturnValue(true);
    resolveExecMock();

    const manager = new GodotPathManager();
    const path = '/custom/godot';

    expect(await manager.isValidGodotPath(path)).toBe(true);
    expect(execMock).toHaveBeenCalledTimes(1);

    execMock.mockClear();

    // Second call should return cached result without hitting exec again
    expect(await manager.isValidGodotPath(path)).toBe(true);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('rejects non-existent paths and avoids executing the binary', async () => {
    existsSyncMock.mockReturnValue(false);

    const manager = new GodotPathManager();
    const missingPath = '/missing/godot';

    expect(await manager.isValidGodotPath(missingPath)).toBe(false);
    expect(execMock).not.toHaveBeenCalled();

    // Changing existsSync after the initial failure should still return cached false
    existsSyncMock.mockReturnValue(true);
    expect(await manager.isValidGodotPath(missingPath)).toBe(false);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('sets the Godot path when provided with a valid executable', async () => {
    existsSyncMock.mockReturnValue(true);
    resolveExecMock();

    const manager = new GodotPathManager();
    const path = '/opt/godot';

    expect(await manager.setGodotPath(path)).toBe(true);
    expect(manager.getPath()).toBe('/opt/godot');
  });
});
