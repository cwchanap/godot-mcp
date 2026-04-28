import { describe, expect, it } from 'vitest';
import { RuntimeControlManager } from './runtime-control-manager.js';

describe('RuntimeControlManager.getRuntimeState', () => {
  it('reports no active runtime session before launch', () => {
    const manager = new RuntimeControlManager();
    expect(manager.getRuntimeState()).toEqual({
      connected: false,
      sessionId: null,
      scenePath: null,
    });
  });
});
