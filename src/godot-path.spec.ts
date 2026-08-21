import type { ChildProcess } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { existsSyncMock, execFileMock } = vi.hoisted(() => {
  return {
    existsSyncMock: vi.fn(),
    execFileMock: vi.fn(),
  };
});

vi.mock('fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

import { GodotPathManager } from './godot-path.js';

const resolveExecFileMock = (implementation?: (file: string, args: string[]) => void) => {
  execFileMock.mockImplementation((file: string, args: string[], arg3?: unknown, arg4?: unknown) => {
    const callback = typeof arg3 === 'function' ? arg3 : (typeof arg4 === 'function' ? arg4 : undefined);
    implementation?.(file, args);
    callback?.(null, 'Godot 4.2.0', '');
    return null as unknown as ChildProcess;
  });
};

describe('GodotPathManager', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    execFileMock.mockReset();
  });

  it('validates a custom Godot path and caches the result', async () => {
    existsSyncMock.mockReturnValue(true);
    resolveExecFileMock();

    const manager = new GodotPathManager();
    const path = '/custom/godot';

    expect(await manager.isValidGodotPath(path)).toBe(true);
    expect(execFileMock).toHaveBeenCalledWith(path, ['--version'], expect.any(Function));

    execFileMock.mockClear();

    // Second call should return cached result without hitting exec again
    expect(await manager.isValidGodotPath(path)).toBe(true);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('rejects non-existent paths and avoids executing the binary', async () => {
    existsSyncMock.mockReturnValue(false);

    const manager = new GodotPathManager();
    const missingPath = '/missing/godot';

    expect(await manager.isValidGodotPath(missingPath)).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();

    // Changing existsSync after the initial failure should still return cached false
    existsSyncMock.mockReturnValue(true);
    expect(await manager.isValidGodotPath(missingPath)).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('sets the Godot path when provided with a valid executable', async () => {
    existsSyncMock.mockReturnValue(true);
    resolveExecFileMock();

    const manager = new GodotPathManager();
    const path = '/opt/godot';

    expect(await manager.setGodotPath(path)).toBe(true);
    expect(manager.getPath()).toBe('/opt/godot');
  });
});
