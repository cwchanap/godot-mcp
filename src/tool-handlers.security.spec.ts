import { describe, expect, it } from 'vitest';

import { ToolHandlers } from './tool-handlers.js';

function createHandlers(): ToolHandlers {
  return new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
    { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
    { normalizeParameters: (args: unknown) => args },
    {}
  );
}

describe('ToolHandlers class-name validation', () => {
  it('rejects a script path as create_scene rootNodeType', async () => {
    const result = await createHandlers().handleCreateScene({
      projectPath: '/workspace/project',
      scenePath: 'scene.tscn',
      rootNodeType: 'res://evil.gd',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Invalid rootNodeType');
  });

  it('rejects a script path as add_node nodeType', async () => {
    const result = await createHandlers().handleAddNode({
      projectPath: '/workspace/project',
      scenePath: 'scene.tscn',
      nodeType: 'res://evil.gd',
      nodeName: 'Evil',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Invalid nodeType');
  });

  it('rejects a script resource in add_node properties', async () => {
    const result = await createHandlers().handleAddNode({
      projectPath: '/workspace/project',
      scenePath: 'scene.tscn',
      nodeType: 'Node',
      nodeName: 'Evil',
      properties: {
        script: 'res://evil.gd',
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Invalid properties');
  });
});
