import type { RuntimeState } from './types.js';

export class RuntimeControlManager {
  getRuntimeState(): RuntimeState {
    return { connected: false, sessionId: null, scenePath: null };
  }
}
