# Runtime Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a managed runtime bridge so `godot-mcp` can install bridge support into a Godot project, connect to a running game, resolve live node paths, invoke supported node actions, and request scene transitions.

**Architecture:** Keep all MCP and runtime-session orchestration inside the existing Node/TypeScript server process by introducing a single `RuntimeControlManager`. Install one GDScript autoload into target projects at `addons/godot_mcp_runtime/`, then use a localhost-only TCP JSON protocol with a short-lived token to connect the running game back to the server.

**Tech Stack:** TypeScript, Node.js `net`, fs-extra, Vitest, GDScript, existing MCP SDK

---

## File Structure

### Create

- `src/runtime-control-manager.ts` — owns bridge install/status/update/remove, starts the localhost TCP server, validates tokens, tracks handshake/session state, and routes runtime commands.
- `src/runtime-control-manager.spec.ts` — unit tests for lifecycle management, handshake state, token checks, command routing, and disconnect behavior.
- `src/tool-handlers.runtime.spec.ts` — unit tests for runtime tool handler behavior and `run_project` runtime launch plumbing.
- `src/runtime-control.integration.spec.ts` — environment-gated integration test for bridge install, handshake, node lookup, node action, and scene transition against the sample Godot project.
- `src/scripts/runtime_bridge.gd` — the autoload script copied into projects as `addons/godot_mcp_runtime/runtime_bridge.gd`.
- `src/scripts/runtime_bridge_manifest.json` — bridge metadata copied into projects as `addons/godot_mcp_runtime/bridge_manifest.json`.
- `docs/superpowers/plans/2026-04-27-runtime-control.md` — this plan.

### Modify

- `src/types.ts` — add runtime-control types, session state, bridge status, and request/response shapes.
- `src/godot-server.ts` — register bridge-management/runtime-control tools and wire the manager into `ToolHandlers`.
- `src/tool-handlers.ts` — integrate `RuntimeControlManager`, extend `run_project`, add runtime tool handlers, and clean up runtime sessions.
- `scripts/build.js` — copy runtime bridge assets into `build/scripts/`.
- `README.md` — document runtime bridge install flow, new tools, and runtime-control constraints.

## Protocol Decisions To Lock In

- **Transport:** localhost TCP via Node `net.createServer()` on the MCP side and Godot `StreamPeerTCP` on the addon side.
- **Message format:** newline-delimited JSON objects.
- **Auth:** short-lived token passed in Godot user args after `--`.
- **Version compatibility rule:** exact match between the bridge manifest version and the MCP package version for the first release.
- **Bridge version source of truth:** `package.json` version copied into `runtime_bridge_manifest.json` during the build step.
- **Addon install target:** `<project>/addons/godot_mcp_runtime/`.
- **Autoload name:** `GodotMcpRuntimeBridge`.
- **Installed version file:** `<project>/addons/godot_mcp_runtime/bridge_manifest.json`.
- **Runtime launch args:** `-- --godot-mcp-port <port> --godot-mcp-token <token> --godot-mcp-session <id>`.

### Runtime JSON contract

Handshake from addon to MCP:

```json
{
  "command": "hello",
  "token": "token-1",
  "version": "0.1.0",
  "sessionId": "session-1",
  "projectPath": "/Users/chanwaichan/workspace/godot-mcp/tilemap-test-project",
  "scenePath": "res://Main.tscn"
}
```

Successful runtime response:

```json
{
  "ok": true,
  "command": "find_node",
  "result": {
    "nodePath": "root/Menu/StartButton",
    "nodeType": "Button"
  }
}
```

Unsupported-action response:

```json
{
  "ok": false,
  "command": "invoke_node_action",
  "error": "Unsupported action",
  "supportedActions": ["press"]
}
```

## Task 1: Define runtime types and manager skeleton

**Files:**
- Create: `src/runtime-control-manager.ts`
- Create: `src/runtime-control-manager.spec.ts`
- Modify: `src/types.ts`

- [ ] **Step 1: Write the failing manager-state test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/runtime-control-manager.spec.ts`
Expected: FAIL with a module-not-found or missing-export error for `RuntimeControlManager`

- [ ] **Step 3: Add minimal runtime types**

```ts
export interface RuntimeState {
  connected: boolean;
  sessionId: string | null;
  scenePath: string | null;
}

export interface RuntimeBridgeStatus {
  installed: boolean;
  version: string | null;
  compatible: boolean;
}
```

- [ ] **Step 4: Add the manager skeleton**

```ts
export class RuntimeControlManager {
  getRuntimeState(): RuntimeState {
    return { connected: false, sessionId: null, scenePath: null };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/runtime-control-manager.spec.ts`
Expected: PASS for the new manager-state test

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/runtime-control-manager.ts src/runtime-control-manager.spec.ts
git commit -m "feat: add runtime control manager skeleton" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 2: Implement bridge install/status/update/remove

**Files:**
- Modify: `src/runtime-control-manager.ts`
- Modify: `src/runtime-control-manager.spec.ts`
- Create: `src/scripts/runtime_bridge.gd`
- Create: `src/scripts/runtime_bridge_manifest.json`
- Modify: `scripts/build.js`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('installs the bridge addon into addons/godot_mcp_runtime', async () => {
  const status = await manager.installBridge(projectPath);
  expect(status.installed).toBe(true);
  expect(status.version).toBe('0.1.0');
});

it('reads bridge status from bridge_manifest.json', async () => {
  expect(await manager.getBridgeStatus(projectPath)).toEqual({
    installed: true,
    version: '0.1.0',
    compatible: true,
  });
});

it('updates the bridge in place and preserves the autoload entry', async () => {
  await manager.installBridge(projectPath);
  await manager.updateBridge(projectPath);
  expect(await manager.getBridgeStatus(projectPath)).toEqual(expect.objectContaining({
    installed: true,
    compatible: true,
  }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/runtime-control-manager.spec.ts`
Expected: FAIL because install/status methods and manifest handling do not exist yet

- [ ] **Step 3: Create the bridge assets**

```json
{
  "name": "godot_mcp_runtime",
  "version": "__PACKAGE_VERSION__",
  "autoloadName": "GodotMcpRuntimeBridge",
  "entryScript": "runtime_bridge.gd"
}
```

```gdscript
extends Node
class_name GodotMcpRuntimeBridge

const BRIDGE_VERSION := "__PACKAGE_VERSION__"
```

- [ ] **Step 4: Implement lifecycle methods and build copying**

```ts
async installBridge(projectPath: string): Promise<RuntimeBridgeStatus> {
  const targetDir = join(projectPath, 'addons', 'godot_mcp_runtime');
  await fs.ensureDir(targetDir);
  await fs.copyFile(this.runtimeBridgeScriptPath, join(targetDir, 'runtime_bridge.gd'));
  await fs.copyFile(this.runtimeBridgeManifestPath, join(targetDir, 'bridge_manifest.json'));
  return this.getBridgeStatus(projectPath);
}

async updateBridge(projectPath: string): Promise<RuntimeBridgeStatus> {
  await this.installBridge(projectPath);
  return this.getBridgeStatus(projectPath);
}
```

```js
const packageVersion = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
const scriptsToCopy = [
  'godot_operations.gd',
  'editor_reimport.gd',
  'runtime_bridge.gd',
];

const runtimeBridgeTemplate = fs.readFileSync(path.join(__dirname, '..', 'src', 'scripts', 'runtime_bridge.gd'), 'utf8');
fs.writeFileSync(
  path.join(__dirname, '..', 'build', 'scripts', 'runtime_bridge.gd'),
  runtimeBridgeTemplate.replaceAll('__PACKAGE_VERSION__', packageVersion),
);
fs.writeFileSync(
  path.join(__dirname, '..', 'build', 'scripts', 'runtime_bridge_manifest.json'),
  JSON.stringify({ name: 'godot_mcp_runtime', version: packageVersion, autoloadName: 'GodotMcpRuntimeBridge', entryScript: 'runtime_bridge.gd' }, null, 2),
);
```

- [ ] **Step 5: Run targeted tests and build**

Run: `npx vitest run src/runtime-control-manager.spec.ts && npm run build`
Expected: PASS for lifecycle tests and successful build output ending with copied runtime bridge assets

- [ ] **Step 6: Commit**

```bash
git add src/runtime-control-manager.ts src/runtime-control-manager.spec.ts src/scripts/runtime_bridge.gd src/scripts/runtime_bridge_manifest.json scripts/build.js
git commit -m "feat: add managed runtime bridge assets" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 3: Add autoload registration and bridge cleanup safety

**Files:**
- Modify: `src/runtime-control-manager.ts`
- Modify: `src/runtime-control-manager.spec.ts`

- [ ] **Step 1: Write failing tests for `project.godot` edits**

```ts
it('registers the GodotMcpRuntimeBridge autoload entry during install', async () => {
  await manager.installBridge(projectPath);
  const projectContents = await fs.readFile(projectFile, 'utf8');
  expect(projectContents).toContain('autoload/GodotMcpRuntimeBridge=');
});

it('refuses uninstall while the bridge session is active', async () => {
  manager.setActiveSessionForTest('session-1');
  await expect(manager.uninstallBridge(projectPath)).rejects.toThrow(/running session/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/runtime-control-manager.spec.ts`
Expected: FAIL because autoload editing and uninstall safety are not implemented

- [ ] **Step 3: Implement deterministic `project.godot` editing**

```ts
private ensureAutoloadSection(projectText: string): string {
  const header = '[autoload]';
  const line = 'autoload/GodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"';
  if (!projectText.includes(header)) {
    return `${projectText.trim()}\n\n${header}\n${line}\n`;
  }
  if (projectText.includes(line)) {
    return projectText;
  }
  return projectText.replace(header, `${header}\n${line}`);
}
```

- [ ] **Step 4: Implement uninstall guard and autoload removal**

```ts
async uninstallBridge(projectPath: string): Promise<void> {
  if (this.activeSessionId) {
    throw new Error('Cannot uninstall runtime bridge while a runtime session is active.');
  }
  // remove addon files and owned autoload line
}
```

```ts
private removeOwnedAutoload(projectText: string): string {
  return projectText
    .split('\n')
    .filter(line => line.trim() !== 'autoload/GodotMcpRuntimeBridge="*res://addons/godot_mcp_runtime/runtime_bridge.gd"')
    .join('\n');
}
```

- [ ] **Step 5: Run tests to verify the lifecycle is safe**

Run: `npx vitest run src/runtime-control-manager.spec.ts`
Expected: PASS for autoload registration, manifest status, and uninstall guard tests

- [ ] **Step 6: Commit**

```bash
git add src/runtime-control-manager.ts src/runtime-control-manager.spec.ts
git commit -m "feat: manage runtime bridge autoload lifecycle" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 4: Wire runtime launch handshake into `run_project`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/godot-server.ts`
- Modify: `src/tool-handlers.ts`
- Create: `src/tool-handlers.runtime.spec.ts`

- [ ] **Step 1: Write failing runtime-launch tests**

```ts
it('starts runtime control only when runtimeControl is true', async () => {
  await handlers.handleRunProject({ projectPath, runtimeControl: true });
  expect(runtimeManager.startSession).toHaveBeenCalled();
});

it('passes runtime control args after -- to Godot', async () => {
  await handlers.handleRunProject({ projectPath, runtimeControl: true });
  expect(spawnMock).toHaveBeenCalledWith(
    expect.any(String),
    expect.arrayContaining(['--', '--godot-mcp-port', '4100', '--godot-mcp-token', 'token-1']),
    expect.anything()
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tool-handlers.runtime.spec.ts`
Expected: FAIL because `runtimeControl` and runtime launch args are not wired into `run_project`

- [ ] **Step 3: Extend schemas and handler plumbing**

```ts
runtimeControl: {
  type: 'boolean',
  description: 'Enable managed runtime bridge control for the launched project.',
  default: false,
}
```

```ts
if (args.runtimeControl === true) {
  const session = await this.runtimeControlManager.startSession(args.projectPath);
  cmdArgs.push('--', '--godot-mcp-port', String(session.port), '--godot-mcp-token', session.token, '--godot-mcp-session', session.sessionId);
}
```

- [ ] **Step 4: Clean up runtime sessions on exit and stop**

```ts
process.on('SIGINT', () => {
  void this.cleanup();
});
process.on('SIGTERM', () => {
  void this.cleanup();
});
```

```ts
async handleStopProject() {
  // stop active Godot process first
  await this.runtimeControlManager.stopSession();
}
```

```ts
async cleanup(): Promise<void> {
  await this.runtimeControlManager.stopSession();
  // existing process/server cleanup follows
}
```

- [ ] **Step 5: Run targeted tests**

Run: `npx vitest run src/tool-handlers.runtime.spec.ts`
Expected: PASS for runtime-enabled launch behavior and cleanup expectations

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/godot-server.ts src/tool-handlers.ts src/tool-handlers.runtime.spec.ts
git commit -m "feat: wire runtime bridge launch into run project" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 5: Add bridge-management MCP tools

**Files:**
- Modify: `src/godot-server.ts`
- Modify: `src/tool-handlers.ts`
- Modify: `src/tool-handlers.runtime.spec.ts`

- [ ] **Step 1: Write failing tool-surface tests**

```ts
it('registers install_runtime_bridge and get_runtime_bridge_status', async () => {
  const tools = await listTools(server);
  expect(tools).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'install_runtime_bridge' }),
    expect.objectContaining({ name: 'get_runtime_bridge_status' }),
    expect.objectContaining({ name: 'update_runtime_bridge' }),
    expect.objectContaining({ name: 'uninstall_runtime_bridge' }),
  ]));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/tool-handlers.runtime.spec.ts`
Expected: FAIL because the bridge-management tools are not registered or handled yet

- [ ] **Step 3: Register and implement the management tools**

```ts
case 'install_runtime_bridge':
  return await this.toolHandlers.handleInstallRuntimeBridge(request.params.arguments);
case 'get_runtime_bridge_status':
  return await this.toolHandlers.handleGetRuntimeBridgeStatus(request.params.arguments);
case 'update_runtime_bridge':
  return await this.toolHandlers.handleUpdateRuntimeBridge(request.params.arguments);
case 'uninstall_runtime_bridge':
  return await this.toolHandlers.handleUninstallRuntimeBridge(request.params.arguments);
```

```ts
async handleInstallRuntimeBridge(args: any) {
  const status = await this.runtimeControlManager.installBridge(args.projectPath);
  return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
}
```

- [ ] **Step 4: Run targeted tests**

Run: `npx vitest run src/tool-handlers.runtime.spec.ts`
Expected: PASS for bridge-management tool registration and basic handler output

- [ ] **Step 5: Commit**

```bash
git add src/godot-server.ts src/tool-handlers.ts src/tool-handlers.runtime.spec.ts
git commit -m "feat: add runtime bridge management tools" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 6: Add runtime-state, node lookup, and scene-transition tools

**Files:**
- Modify: `src/runtime-control-manager.ts`
- Modify: `src/godot-server.ts`
- Modify: `src/tool-handlers.ts`
- Modify: `src/runtime-control-manager.spec.ts`
- Modify: `src/tool-handlers.runtime.spec.ts`

- [ ] **Step 1: Write failing routing tests**

```ts
it('returns a disconnected error when change_scene is called without a connected bridge', async () => {
  await expect(manager.changeScene('res://Main.tscn')).rejects.toThrow(/not connected/i);
});

it('returns a reconnect-required error after the active socket disconnects', async () => {
  manager.setDisconnectedForTest();
  await expect(manager.findNode('root/Menu/StartButton')).rejects.toThrow(/reconnect-required/i);
});

it('routes find_node to the active bridge session', async () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/runtime-control-manager.spec.ts src/tool-handlers.runtime.spec.ts`
Expected: FAIL because runtime command routing methods and MCP tools do not exist yet

- [ ] **Step 3: Implement runtime command methods**

```ts
async findNode(nodePath: string) {
  return this.sendCommand({ command: 'find_node', nodePath });
}

async changeScene(scenePath: string) {
  return this.sendCommand({ command: 'change_scene', scenePath });
}
```

- [ ] **Step 4: Register `get_runtime_state`, `find_node`, and `change_scene`**

```ts
{
  name: 'change_scene',
  description: 'Request a scene transition in the running Godot project',
  inputSchema: {
    type: 'object',
    properties: {
      scenePath: { type: 'string' },
    },
    required: ['scenePath'],
  },
}
```

- [ ] **Step 5: Run targeted tests**

Run: `npx vitest run src/runtime-control-manager.spec.ts src/tool-handlers.runtime.spec.ts`
Expected: PASS for disconnected-session errors, command routing, and runtime tool registration

- [ ] **Step 6: Commit**

```bash
git add src/runtime-control-manager.ts src/runtime-control-manager.spec.ts src/godot-server.ts src/tool-handlers.ts src/tool-handlers.runtime.spec.ts
git commit -m "feat: add runtime state and scene transition tools" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 7: Add `invoke_node_action` and implement the GDScript bridge protocol

**Files:**
- Modify: `src/runtime-control-manager.ts`
- Modify: `src/runtime-control-manager.spec.ts`
- Modify: `src/godot-server.ts`
- Modify: `src/tool-handlers.ts`
- Modify: `src/tool-handlers.runtime.spec.ts`
- Modify: `src/scripts/runtime_bridge.gd`

- [ ] **Step 1: Write failing allowlist tests**

```ts
it('rejects unsupported node actions before dispatch', async () => {
  await expect(manager.invokeNodeAction('root/Menu/Label', 'press')).rejects.toThrow(/unsupported/i);
});

it('routes button press actions to the connected bridge session', async () => {
  await manager.invokeNodeAction('root/Menu/StartButton', 'press');
  expect(sendCommandMock).toHaveBeenCalledWith(expect.objectContaining({
    command: 'invoke_node_action',
    nodePath: 'root/Menu/StartButton',
    action: 'press',
  }));
});

it('rejects handshakes that present the wrong token', async () => {
  await expect(manager.acceptHandshake({
    token: 'wrong-token',
    version: '0.1.0',
    sessionId: 'session-1',
    projectPath,
  })).rejects.toThrow(/invalid token/i);
});

it('rejects handshakes with a bridge version mismatch', async () => {
  await expect(manager.acceptHandshake({
    token: 'token-1',
    version: '0.0.9',
    sessionId: 'session-1',
    projectPath,
  })).rejects.toThrow(/version mismatch/i);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/runtime-control-manager.spec.ts src/tool-handlers.runtime.spec.ts`
Expected: FAIL because `invoke_node_action` is not implemented and action validation is missing

- [ ] **Step 3: Implement the allowlisted MCP/tool side**

```ts
const SUPPORTED_NODE_ACTIONS = new Map([
  ['BaseButton', ['press']],
]);
```

```ts
async acceptHandshake(payload: RuntimeHandshakeRequest) {
  if (payload.token !== this.expectedToken) {
    throw new Error('Invalid token');
  }
  if (payload.version !== this.expectedBridgeVersion) {
    throw new Error('Bridge version mismatch');
  }
  if (payload.projectPath !== this.expectedProjectPath) {
    throw new Error('Bridge connected for the wrong project');
  }
}

async invokeNodeAction(nodePath: string, action: string) {
  return this.sendCommand({ command: 'invoke_node_action', nodePath, action });
}
```

- [ ] **Step 4: Implement the GDScript bridge handshake and commands**

```gdscript
func _ready() -> void:
    _connect_to_server()

func _handle_command(message: Dictionary) -> Dictionary:
    match message.get("command", ""):
        "find_node":
            return _find_node(message["nodePath"])
        "change_scene":
            return _change_scene(message["scenePath"])
        "invoke_node_action":
            return _invoke_node_action(message["nodePath"], message["action"])
        _:
            return {"ok": false, "error": "Unsupported command"}

func _send_hello() -> void:
    _send_message({
        "command": "hello",
        "token": _token,
        "version": BRIDGE_VERSION,
        "sessionId": _session_id,
        "projectPath": ProjectSettings.globalize_path("res://"),
        "scenePath": _get_current_scene_path(),
    })
```

```gdscript
func _invoke_node_action(node_path: String, action: String) -> Dictionary:
    var node := get_node_or_null(NodePath(node_path))
    if node == null:
        return {"ok": false, "error": "Node not found"}
    if node is BaseButton and action == "press":
        node.emit_signal("pressed")
        return {"ok": true, "result": {"nodePath": node_path, "action": action}}
    var supported_actions: Array = []
    if node is BaseButton:
        supported_actions = ["press"]
    return {
        "ok": false,
        "error": "Unsupported action",
        "supportedActions": supported_actions
    }
```

- [ ] **Step 5: Run targeted tests and build**

Run: `npx vitest run src/runtime-control-manager.spec.ts src/tool-handlers.runtime.spec.ts && npm run build`
Expected: PASS for action allowlisting and successful build copying the updated bridge script

- [ ] **Step 6: Commit**

```bash
git add src/runtime-control-manager.ts src/runtime-control-manager.spec.ts src/godot-server.ts src/tool-handlers.ts src/tool-handlers.runtime.spec.ts src/scripts/runtime_bridge.gd
git commit -m "feat: add runtime node action bridge" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 8: Add automated integration coverage for the runtime flow

**Files:**
- Create: `src/runtime-control.integration.spec.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
it('installs the bridge and controls the sample project end-to-end', async () => {
  const result = await runRuntimeFlowFixture();
  expect(result.bridgeInstalled).toBe(true);
  expect(result.connected).toBe(true);
  expect(result.findNode.nodeType).toBe('Button');
  expect(result.changeScene.ok).toBe(true);
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run: `GODOT_PATH=/absolute/path/to/Godot npx vitest run src/runtime-control.integration.spec.ts`
Expected: FAIL because the runtime flow helpers and bridge behavior are not fully implemented yet

- [ ] **Step 3: Implement the environment-gated integration harness**

```ts
const hasGodot = Boolean(process.env.GODOT_PATH);

describe.skipIf(!hasGodot)('runtime control integration', () => {
  it('installs the bridge and controls the sample project end-to-end', async () => {
    // copy tilemap-test-project to .tmp/runtime-control-fixture under the repo root,
    // install bridge, run with runtimeControl,
    // then exercise get_runtime_state/find_node/invoke_node_action/change_scene
  });
});
```

- [ ] **Step 4: Run the integration test again**

Run: `GODOT_PATH=/absolute/path/to/Godot npx vitest run src/runtime-control.integration.spec.ts`
Expected: PASS when a valid Godot binary is configured; SKIP when `GODOT_PATH` is not set

- [ ] **Step 5: Commit**

```bash
git add src/runtime-control.integration.spec.ts
git commit -m "test: add runtime control integration coverage" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Task 9: Update README and run full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the README changes**

```md
- **Runtime Bridge Management**:
  - Install, update, inspect, and remove the runtime bridge addon
- **Runtime Control**:
  - Inspect runtime state
  - Find live nodes by path
  - Invoke supported button-like actions
  - Change scenes in a running game
```

- [ ] **Step 2: Add setup and usage examples**

```text
"Install the runtime bridge for /path/to/project"
"Run my project with runtime control enabled"
"Find node root/Menu/StartButton in the running game"
"Change the running game to res://Level2.tscn"
```

- [ ] **Step 3: Run the full automated verification**

Run: `npm run test && npm run build`
Expected: PASS for Vitest and successful TypeScript/build script output

- [ ] **Step 4: Run a manual runtime smoke test against the sample project**

Run: `npm run inspector`
Expected: MCP Inspector starts and can be used to:
- call `install_runtime_bridge` with `/Users/chanwaichan/workspace/godot-mcp/tilemap-test-project`
- call `run_project` with `runtimeControl: true`
- call `get_runtime_state`, `find_node`, and `change_scene` against the running sample project

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document runtime control workflow" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

## Notes For The Implementer

- Use `@superpowers:test-driven-development` discipline inside each task even when the code change feels small.
- Use `@superpowers:verification-before-completion` before claiming the feature is done.
- Keep `RuntimeControlManager` as the only top-level MCP-side runtime subsystem. Internal helpers are fine, but do not split the design into multiple peer managers.
- Do not add low-level mouse or keyboard simulation in this plan. That is explicitly out of scope for this slice.
