import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { OperationExecutor } from './operation-executor.js';

describe('OperationExecutor', () => {
  it('passes paths and JSON to Godot as separate process arguments', async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), 'godot-mcp-operation-'));

    try {
      const executablePath = join(tempDirectory, 'fake-godot');
      const markerPath = join(tempDirectory, 'injected');
      const operationsScriptPath = join(tempDirectory, 'godot_operations.gd');
      const projectPath = `/projects/game"; touch "${markerPath}"; #`;

      await writeFile(
        executablePath,
        '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n'
      );
      await chmod(executablePath, 0o755);

      const executor = new OperationExecutor(operationsScriptPath);
      const result = await executor.executeOperation(
        'add_node',
        { nodeName: 'Player; rm -rf ignored' },
        projectPath,
        { getPath: () => executablePath } as any
      );

      expect(JSON.parse(result.stdout)).toEqual([
        '--headless',
        '--path',
        projectPath,
        '--script',
        operationsScriptPath,
        'add_node',
        '{"node_name":"Player; rm -rf ignored"}',
      ]);
      expect(existsSync(markerPath)).toBe(false);
    } finally {
      await rm(tempDirectory, { recursive: true, force: true });
    }
  });
});
