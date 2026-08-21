import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execFileAsyncMock, execFileMock } = vi.hoisted(() => {
  const execFileAsyncMock = vi.fn();
  const execFileMock = vi.fn();

  Object.defineProperty(execFileMock, Symbol.for('nodejs.util.promisify.custom'), {
    value: execFileAsyncMock,
  });

  return { execFileAsyncMock, execFileMock };
});

vi.mock('child_process', () => ({
  execFile: execFileMock,
}));

import type { GodotPathManager } from './godot-path.js';
import { OperationExecutor } from './operation-executor.js';

describe('OperationExecutor', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset();
    execFileAsyncMock.mockResolvedValue({ stdout: 'ok', stderr: '' });
  });

  it('passes paths and JSON to Godot as separate process arguments', async () => {
    const executor = new OperationExecutor('/server/scripts/godot_operations.gd');
    const projectPath = '/projects/game"; touch /tmp/injected; #';

    const result = await executor.executeOperation(
      'add_node',
      { nodeName: 'Player; rm -rf ignored' },
      projectPath,
      { getPath: () => '/Applications/Godot' } as unknown as GodotPathManager
    );

    expect(result).toEqual({ stdout: 'ok', stderr: '' });
    expect(execFileAsyncMock).toHaveBeenCalledWith(
      '/Applications/Godot',
      [
        '--headless',
        '--path',
        projectPath,
        '--script',
        '/server/scripts/godot_operations.gd',
        'add_node',
        '{"node_name":"Player; rm -rf ignored"}',
      ]
    );
  });
});
