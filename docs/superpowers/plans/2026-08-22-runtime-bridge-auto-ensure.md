# Runtime Bridge Auto-Ensure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `run_project` with `runtimeControl: true` automatically install, repair, or update the managed Godot runtime bridge, while replacing the redundant install/update MCP tools with one idempotent `ensure_runtime_bridge` tool.

**Architecture:** Keep the existing managed-addon architecture and `RuntimeControlManager` ownership boundaries. Add one idempotent manager operation that classifies bridge preparation as `installed`, `updated`, or `unchanged`; call it from `run_project` before any active process is replaced; expose the same operation as the only mutating bridge-setup MCP tool alongside status and uninstall.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest, GDScript managed addon assets, existing MCP SDK

**Spec:** `docs/superpowers/specs/2026-04-27-runtime-control-design.md` — this plan amends only the installation workflow and bridge-management tool surface; the localhost transport, autoload path, session handshake, runtime commands, and exact-version compatibility model remain unchanged.

## Global Constraints

- Deliver this task as **one PR** on a single branch; do not split planning, implementation, docs, or tests into separate PRs.
- `run_project` must modify a project only when `runtimeControl: true`; normal launches remain read/run-only with respect to the runtime bridge.
- Runtime bridge preparation must complete **before** killing or replacing an existing Godot process, so a failed install/update leaves the current game running.
- Keep the managed addon at `addons/godot_mcp_runtime/` with autoload name `GodotMcpRuntimeBridge` and exact package-version compatibility.
- Preserve the current behavior that a partial install, missing autoload entry, or wrong owned autoload path is reported as not installed and can be repaired by rewriting the managed bridge.
- Preserve uninstall safety: an active session for the same project blocks uninstall.
- Remove `install_runtime_bridge` and `update_runtime_bridge` from the MCP surface rather than retaining aliases; there are no backward-compatibility requirements for this hobby project.
- Do not redesign the runtime transport, screenshot path, node actions, TileMap tools, package format, or Codex plugin wrapper in this PR.
- Keep the implementation small: reuse the existing bridge-copy/autoload logic rather than introducing a package manager, plugin installer subsystem, or generic migration framework.

---

## File Structure

### Modify

- `src/types.ts` — replace separate install/update methods in `RuntimeBridgeManager` with `ensureBridge`, and define the small result/action type used by manager, handler, and tests.
- `src/runtime-control-manager.ts` — implement idempotent bridge preparation using the existing status/copy/autoload primitives; keep status and uninstall behavior unchanged.
- `src/runtime-control-manager.spec.ts` — convert lifecycle coverage from explicit install/update semantics to install/update/no-op ensure semantics while retaining partial-install, autoload, manifest, and uninstall regression tests.
- `src/tool-handlers.ts` — auto-ensure the bridge during runtime-controlled launch before replacing the active process; replace explicit install/update handlers with one ensure handler.
- `src/tool-handlers.runtime.spec.ts` — cover launch-time auto-ensure ordering/failure behavior and the consolidated MCP bridge-management surface.
- `src/godot-server.ts` — register and dispatch `ensure_runtime_bridge`; remove `install_runtime_bridge` and `update_runtime_bridge` registrations/dispatch branches.
- `src/runtime-control.integration.spec.ts` — prove a clean fixture can launch with runtime control without a separate install call and that the installed bridge is then reported healthy.
- `README.md` — document zero-manual-setup runtime launch, optional explicit ensure/status/uninstall tools, and refresh the Cline `autoApprove` tool list so it matches the current server surface.
- `docs/superpowers/specs/2026-04-27-runtime-control-design.md` — amend the installation model, runtime session flow, lifecycle tool list, and missing/stale bridge error expectations to match auto-ensure behavior.

### Create

- `docs/superpowers/plans/2026-08-22-runtime-bridge-auto-ensure.md` — this implementation plan.

## Interfaces To Lock In

Add these types in `src/types.ts`:

```ts
export type RuntimeBridgeEnsureAction = 'installed' | 'updated' | 'unchanged';

export interface RuntimeBridgeEnsureOptions {
  allowActiveSessionMutation?: boolean;
}

export interface RuntimeBridgeEnsureResult {
  version: string;
  action: RuntimeBridgeEnsureAction;
}
```

Update the manager contract to:

```ts
export interface RuntimeBridgeManager extends RuntimeControlSessionManager {
  ensureBridge(projectPath: string, options?: RuntimeBridgeEnsureOptions): Promise<RuntimeBridgeEnsureResult>;
  getBridgeStatus(projectPath: string): Promise<RuntimeBridgeStatus>;
  uninstallBridge(projectPath: string): Promise<void>;
}
```

`ensureBridge(projectPath)` semantics:

```text
current status: installed=true, compatible=true
  -> no filesystem mutation
  -> action = "unchanged"

current status: installed=true, compatible=false
  -> rewrite managed bridge files and canonical autoload
  -> action = "updated"

current status: installed=false
  -> write/repair managed bridge files and canonical autoload
  -> action = "installed"
```

The ensure result is intentionally minimal: `{ action, version }`. Successful ensure is the postcondition; callers that need variable `installed`/`compatible` state use `get_runtime_bridge_status`. Standalone ensure refuses same-project mutation while a runtime session is active; controlled restart passes `allowActiveSessionMutation: true` because it replaces that process immediately after successful preflight.

`run_project({ runtimeControl: true })` ordering:

```text
validate project
  -> ensureBridge(projectPath, { allowActiveSessionMutation: true })
  -> if ensure fails: return error; keep existing process/session untouched
  -> kill old process and stop old runtime session if present
  -> start new runtime session
  -> launch Godot with runtime args
```

The MCP bridge-management surface after this PR is exactly:

```text
ensure_runtime_bridge
get_runtime_bridge_status
uninstall_runtime_bridge
```

---

### Task 1: Consolidate bridge preparation in `RuntimeControlManager`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/runtime-control-manager.ts`
- Modify: `src/runtime-control-manager.spec.ts`

**Interfaces:**
- Consumes: existing `RuntimeBridgeStatus`, `getBridgeStatus(projectPath)`, managed asset paths, canonical autoload helpers.
- Produces: `RuntimeBridgeEnsureAction`, `RuntimeBridgeEnsureResult`, and `RuntimeControlManager.ensureBridge(projectPath): Promise<RuntimeBridgeEnsureResult>` for Task 2 and Task 3.

- [ ] **Step 1: Replace lifecycle contract expectations with a failing `ensureBridge` contract test**

In `src/runtime-control-manager.spec.ts`, add a focused test beside the current bridge lifecycle tests:

```ts
it('installs a missing bridge and reports the install action', async () => {
  const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });

  const result = await manager.ensureBridge(projectPath);

  expect(result).toEqual({
    version: bridgeVersion,
    action: 'installed',
  });
  await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.toContain(bridgeVersion);
  await expect(readFile(manifestPath, 'utf8')).resolves.toContain(bridgeVersion);
  await expect(readFile(projectFile, 'utf8')).resolves.toContain(canonicalRuntimeBridgeAutoloadLine);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run src/runtime-control-manager.spec.ts -t "installs a missing bridge and reports the install action"
```

Expected: FAIL because `ensureBridge` is not defined.

- [ ] **Step 3: Add the ensure result types and update `RuntimeBridgeManager`**

In `src/types.ts`, add:

```ts
export type RuntimeBridgeEnsureAction = 'installed' | 'updated' | 'unchanged';

export interface RuntimeBridgeEnsureOptions {
  allowActiveSessionMutation?: boolean;
}

export interface RuntimeBridgeEnsureResult {
  version: string;
  action: RuntimeBridgeEnsureAction;
}
```

Replace the install/update methods in `RuntimeBridgeManager` with:

```ts
export interface RuntimeBridgeManager extends RuntimeControlSessionManager {
  ensureBridge(projectPath: string, options?: RuntimeBridgeEnsureOptions): Promise<RuntimeBridgeEnsureResult>;
  getBridgeStatus(projectPath: string): Promise<RuntimeBridgeStatus>;
  uninstallBridge(projectPath: string): Promise<void>;
}
```

Import `RuntimeBridgeEnsureResult` into `src/runtime-control-manager.ts`.

- [ ] **Step 4: Extract the existing write path and implement `ensureBridge` minimally**

Refactor the current `installBridge` body into one private write helper so install and update do not remain separate public concepts:

```ts
async ensureBridge(projectPath: string): Promise<RuntimeBridgeEnsureResult> {
  const current = await this.getBridgeStatus(projectPath);
  if (current.installed && current.compatible) {
    return { ...current, action: 'unchanged' };
  }

  const action = current.installed ? 'updated' : 'installed';
  const status = await this.writeBridge(projectPath);

  if (!status.installed || !status.compatible) {
    throw new Error('Runtime bridge preparation did not produce a compatible managed bridge.');
  }

  return { ...status, action };
}

private async writeBridge(projectPath: string): Promise<RuntimeBridgeStatus> {
  const targetDir = this.getBridgeTargetDir(projectPath);
  await mkdir(targetDir, { recursive: true });
  await this.copyBridgeAsset(this.runtimeBridgeScriptPath, join(targetDir, RUNTIME_BRIDGE_SCRIPT));
  await this.copyBridgeAsset(this.runtimeBridgeManifestPath, join(targetDir, RUNTIME_BRIDGE_MANIFEST));
  await this.updateProjectAutoload(projectPath, (projectText) => this.ensureAutoloadSection(projectText));
  return this.getBridgeStatus(projectPath);
}
```

Delete the public `installBridge` and `updateBridge` methods after callers/tests are migrated in this PR; do not keep wrappers.

- [ ] **Step 5: Run the missing-bridge test and verify it passes**

Run:

```bash
npx vitest run src/runtime-control-manager.spec.ts -t "installs a missing bridge and reports the install action"
```

Expected: PASS.

- [ ] **Step 6: Add failing tests for stale and already-current bridges**

Adapt the existing stale-version setup and add:

```ts
it('updates an incompatible installed bridge and reports the update action', async () => {
  const staleVersion = '0.0.1-stale';
  await mkdir(bridgeDir, { recursive: true });
  await writeFile(manifestPath, JSON.stringify({
    name: 'godot_mcp_runtime',
    version: staleVersion,
    autoloadName: 'GodotMcpRuntimeBridge',
    entryScript: 'runtime_bridge.gd',
  }, null, 2));
  await writeFile(
    path.join(bridgeDir, 'runtime_bridge.gd'),
    (await readFile(sourceBridgeScriptPath, 'utf8')).replaceAll('__PACKAGE_VERSION__', staleVersion)
  );
  await writeFile(
    projectFile,
    `[application]\nconfig/name="Runtime Control Test"\n\n[autoload]\n${canonicalRuntimeBridgeAutoloadLine}\n`
  );

  const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
  const result = await manager.ensureBridge(projectPath);

  expect(result).toEqual({
    installed: true,
    version: bridgeVersion,
    compatible: true,
    action: 'updated',
  });
  await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.not.toContain(staleVersion);
});

it('leaves an already compatible bridge unchanged', async () => {
  const manager = new RuntimeControlManager({ runtimeBridgeAssetsDir: generatedAssetsPath });
  await manager.ensureBridge(projectPath);
  const scriptBefore = await readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8');
  const projectBefore = await readFile(projectFile, 'utf8');

  const result = await manager.ensureBridge(projectPath);

  expect(result).toEqual({
    installed: true,
    version: bridgeVersion,
    compatible: true,
    action: 'unchanged',
  });
  await expect(readFile(path.join(bridgeDir, 'runtime_bridge.gd'), 'utf8')).resolves.toBe(scriptBefore);
  await expect(readFile(projectFile, 'utf8')).resolves.toBe(projectBefore);
});
```

- [ ] **Step 7: Run the focused ensure lifecycle tests**

Run:

```bash
npx vitest run src/runtime-control-manager.spec.ts -t "bridge|ensure|compatible"
```

Expected: PASS for missing, stale, current, partial-install/status, autoload, and manifest cases after replacing direct `installBridge`/`updateBridge` setup calls with `ensureBridge` where appropriate.

- [ ] **Step 8: Preserve uninstall tests by migrating setup only**

Where existing uninstall tests currently call:

```ts
await manager.installBridge(projectPath);
```

replace setup with:

```ts
await manager.ensureBridge(projectPath);
```

Do not change `uninstallBridge` behavior or its assertions.

- [ ] **Step 9: Run the manager test file**

Run:

```bash
npx vitest run src/runtime-control-manager.spec.ts
```

Expected: PASS.

- [ ] **Step 10: Commit the manager-level consolidation**

```bash
git add src/types.ts src/runtime-control-manager.ts src/runtime-control-manager.spec.ts
git commit -m "refactor: consolidate runtime bridge preparation"
```

---

### Task 2: Auto-ensure the bridge before runtime-controlled launch

**Files:**
- Modify: `src/tool-handlers.ts`
- Modify: `src/tool-handlers.runtime.spec.ts`

**Interfaces:**
- Consumes: `RuntimeBridgeManager.ensureBridge(projectPath)` from Task 1.
- Produces: `handleRunProject` behavior where `runtimeControl: true` prepares the bridge before replacing any active process.

- [ ] **Step 1: Replace the old missing/incompatible preflight tests with a failing auto-ensure launch test**

In `src/tool-handlers.runtime.spec.ts`, replace the tests that expect missing/incompatible bridges to reject launch with:

```ts
it('ensures the runtime bridge before starting a controlled session', async () => {
  const runtimeManager = {
    ensureBridge: vi.fn().mockResolvedValue({
      installed: true,
      version: '0.1.4',
      compatible: true,
      action: 'installed',
    }),
    startSession: vi.fn().mockResolvedValue({
      port: 4100,
      token: 'token-1',
      sessionId: 'session-1',
    }),
    stopSession: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
  const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
    { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
    { normalizeParameters: (args: unknown) => args },
    runtimeManager
  );

  const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });

  expect(result.isError).not.toBe(true);
  expect(runtimeManager.ensureBridge).toHaveBeenCalledWith(projectPath);
  expect(runtimeManager.ensureBridge.mock.invocationCallOrder[0])
    .toBeLessThan(runtimeManager.startSession.mock.invocationCallOrder[0]);
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run src/tool-handlers.runtime.spec.ts -t "ensures the runtime bridge before starting a controlled session"
```

Expected: FAIL because `handleRunProject` still calls `getBridgeStatus` and rejects missing/stale state instead of ensuring it.

- [ ] **Step 3: Replace bridge status preflight with `ensureBridge`**

In `handleRunProject`, keep validation before process replacement and reduce the runtime-control preflight to:

```ts
const shouldStartRuntimeControl = args.runtimeControl === true;
let bridgeEnsureAction: 'installed' | 'updated' | 'unchanged' | null = null;

if (shouldStartRuntimeControl) {
  const bridgeResult = await this.runtimeControlManager.ensureBridge(args.projectPath);
  bridgeEnsureAction = bridgeResult.action;
}
```

Delete the missing/incompatible branches that tell the caller to invoke install/update manually.

Do not move this block below the existing-process kill logic.

- [ ] **Step 4: Make the successful launch text report the bridge action without changing response structure**

Keep the existing MCP text response and append runtime context only for controlled launches:

```ts
const runtimeMessage = shouldStartRuntimeControl
  ? ` Runtime control enabled; bridge ${bridgeEnsureAction}.`
  : '';

return {
  content: [{
    type: 'text',
    text: `Godot project started in debug mode.${runtimeMessage} Use get_debug_output to see output.`,
  }],
};
```

This avoids introducing a new response schema solely for setup metadata.

- [ ] **Step 5: Run the focused auto-ensure launch test**

Run:

```bash
npx vitest run src/tool-handlers.runtime.spec.ts -t "ensures the runtime bridge before starting a controlled session"
```

Expected: PASS.

- [ ] **Step 6: Add the failure-ordering regression test**

Add:

```ts
it('keeps the existing process running when runtime bridge preparation fails', async () => {
  const runtimeManager = {
    ensureBridge: vi.fn().mockRejectedValue(new Error('EACCES: permission denied')),
    startSession: vi.fn(),
    stopSession: vi.fn().mockResolvedValue(undefined),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
  const handlers = new (ToolHandlers as unknown as new (...args: any[]) => ToolHandlers)(
    { getPath: () => '/Applications/Godot.app/Contents/MacOS/Godot' },
    { normalizeParameters: (args: unknown) => args },
    runtimeManager
  );

  await handlers.handleRunProject({ projectPath });
  const firstProcess = spawnMock.mock.results[0].value;

  const result = await handlers.handleRunProject({ projectPath, runtimeControl: true });

  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('EACCES');
  expect(firstProcess.kill).not.toHaveBeenCalled();
  expect(runtimeManager.startSession).not.toHaveBeenCalled();
  expect(runtimeManager.stopSession).not.toHaveBeenCalled();
  expect((handlers as any).activeProcess?.process).toBe(firstProcess);
});
```

- [ ] **Step 7: Keep normal launches free of bridge writes**

Update the existing `starts runtime control only when runtimeControl is true` test so its runtime manager includes `ensureBridge`, then assert:

```ts
await handlers.handleRunProject({ projectPath });
expect(runtimeManager.ensureBridge).not.toHaveBeenCalled();
expect(runtimeManager.startSession).not.toHaveBeenCalled();
```

After the controlled launch, assert both are called exactly once.

- [ ] **Step 8: Update the remaining runtime-manager fakes**

Every fake used by a test that calls `handleRunProject({ ..., runtimeControl: true })` must provide:

```ts
ensureBridge: vi.fn().mockResolvedValue({
  installed: true,
  version: '0.1.4',
  compatible: true,
  action: 'unchanged',
}),
```

Remove obsolete `getBridgeStatus` fakes from launch tests. Do not add `ensureBridge` to runtime-command-only fakes that never launch a controlled project.

- [ ] **Step 9: Run all runtime handler tests**

Run:

```bash
npx vitest run src/tool-handlers.runtime.spec.ts
```

Expected: PASS, including process-restart race, cleanup, spawn failure, runtime arg placement, and screenshot delegation coverage.

- [ ] **Step 10: Commit launch-time auto-ensure**

```bash
git add src/tool-handlers.ts src/tool-handlers.runtime.spec.ts
git commit -m "feat: auto-ensure runtime bridge on launch"
```

---

### Task 3: Replace explicit install/update MCP tools with `ensure_runtime_bridge`

**Files:**
- Modify: `src/godot-server.ts`
- Modify: `src/tool-handlers.ts`
- Modify: `src/tool-handlers.runtime.spec.ts`

**Interfaces:**
- Consumes: `RuntimeBridgeManager.ensureBridge(projectPath)` from Task 1.
- Produces: one explicit mutating setup tool, `ensure_runtime_bridge`, plus the existing status/uninstall tools.

- [ ] **Step 1: Change the server registration test first**

Replace the current bridge-management tool-list expectation with:

```ts
it('registers the consolidated runtime bridge management tools', async () => {
  const server = new GodotServer();
  const tools = await listTools(server);
  const names = tools.map((tool) => tool.name);

  expect(names).toEqual(expect.arrayContaining([
    'ensure_runtime_bridge',
    'get_runtime_bridge_status',
    'uninstall_runtime_bridge',
  ]));
  expect(names).not.toContain('install_runtime_bridge');
  expect(names).not.toContain('update_runtime_bridge');
});
```

- [ ] **Step 2: Run the registration test and verify it fails**

Run:

```bash
npx vitest run src/tool-handlers.runtime.spec.ts -t "registers the consolidated runtime bridge management tools"
```

Expected: FAIL because the server still exposes install/update and does not expose ensure.

- [ ] **Step 3: Replace server tool definitions and dispatch branches**

In `src/godot-server.ts`, remove the `install_runtime_bridge` and `update_runtime_bridge` tool definitions and add:

```ts
{
  name: 'ensure_runtime_bridge',
  description: 'Install, repair, or update the managed runtime bridge in a Godot project',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Path to the Godot project directory',
      },
    },
    required: ['projectPath'],
  },
},
```

Replace dispatch cases with:

```ts
case 'ensure_runtime_bridge':
  return await this.toolHandlers.handleEnsureRuntimeBridge(request.params.arguments);
```

Keep `get_runtime_bridge_status` and `uninstall_runtime_bridge` unchanged.

- [ ] **Step 4: Replace explicit install/update handler methods with one ensure handler**

In `src/tool-handlers.ts`, delete `handleInstallRuntimeBridge` and `handleUpdateRuntimeBridge` and add one method using the same path/project validation pattern:

```ts
async handleEnsureRuntimeBridge(args: any) {
  args = this.operationExecutor.normalizeParameters(args);

  if (!args.projectPath) {
    return this.createErrorResponse(
      'Project path is required',
      ['Provide a valid path to a Godot project directory']
    );
  }

  if (!ProjectUtils.validatePath(args.projectPath)) {
    return this.createErrorResponse(
      'Invalid project path',
      ['Provide a valid path without ".." or other potentially unsafe characters']
    );
  }

  try {
    if (!ProjectUtils.isValidGodotProject(args.projectPath)) {
      return this.createErrorResponse(
        `Not a valid Godot project: ${args.projectPath}`,
        [
          'Ensure the path points to a directory containing a project.godot file',
          'Use list_projects to find valid Godot projects',
        ]
      );
    }

    const result = await this.runtimeControlManager.ensureBridge(args.projectPath);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error: any) {
    return this.createErrorResponse(
      `Failed to ensure runtime bridge: ${error?.message || 'Unknown error'}`,
      ['Ensure the project path is writable and contains a valid Godot project']
    );
  }
}
```

- [ ] **Step 5: Update the MCP delegation test**

Replace install/update mocks and calls with:

```ts
const ensureResponse = {
  content: [{
    type: 'text' as const,
    text: '{"installed":true,"compatible":true,"action":"unchanged"}',
  }],
};
const handleEnsureRuntimeBridge = vi.fn().mockResolvedValue(ensureResponse);
```

Call:

```ts
await expect(client.callTool({
  name: 'ensure_runtime_bridge',
  arguments: { projectPath },
})).resolves.toEqual(ensureResponse);
```

Assert `handleEnsureRuntimeBridge` receives `{ projectPath }`, while status and uninstall delegation assertions remain.

- [ ] **Step 6: Run the bridge-management server tests**

Run:

```bash
npx vitest run src/tool-handlers.runtime.spec.ts -t "runtime bridge management|consolidated runtime bridge"
```

Expected: PASS and no references to the removed MCP names in the server/handler test expectations.

- [ ] **Step 7: Run typecheck to catch stale contract references**

Run:

```bash
npm run typecheck
```

Expected: PASS. Any compile failure referring to `installBridge`, `updateBridge`, `handleInstallRuntimeBridge`, or `handleUpdateRuntimeBridge` must be migrated rather than papered over with compatibility wrappers.

- [ ] **Step 8: Commit the MCP surface consolidation**

```bash
git add src/godot-server.ts src/tool-handlers.ts src/tool-handlers.runtime.spec.ts
git commit -m "refactor: simplify runtime bridge tools"
```

---

### Task 4: Prove zero-setup runtime launch and align documentation

**Files:**
- Modify: `src/runtime-control.integration.spec.ts`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-04-27-runtime-control-design.md`

**Interfaces:**
- Consumes: launch-time auto-ensure from Task 2 and `get_runtime_bridge_status` from the unchanged status tool.
- Produces: end-to-end proof that a clean fixture needs no explicit setup call, plus user-facing docs/spec matching the new behavior.

- [ ] **Step 1: Change the integration fixture to launch before checking bridge status**

In both `runRuntimeFlowFixture` and `runPausedTreeFixture`, delete the explicit:

```ts
await callJsonTool(client, 'install_runtime_bridge', { projectPath: scratchFixturePath });
```

Start the project directly:

```ts
const runResult = await callTool(client, 'run_project', {
  projectPath: scratchFixturePath,
  runtimeControl: true,
});

if (runResult.isError) {
  throw new Error(getTextContent(runResult));
}

const bridgeStatus = await callJsonTool<{
  installed: boolean;
  compatible: boolean;
}>(client, 'get_runtime_bridge_status', {
  projectPath: scratchFixturePath,
});
```

Require:

```ts
expect(bridgeStatus).toEqual(expect.objectContaining({
  installed: true,
  compatible: true,
}));
```

Keep the rest of the runtime handshake, node action, scene change, pause, and screenshot flow unchanged.

- [ ] **Step 2: Run the integration test when Godot is available**

With `GODOT_PATH` already exported to a Godot executable, run:

```bash
GODOT_RUNTIME_INTEGRATION_TEST=1 npx vitest run src/runtime-control.integration.spec.ts
```

Expected: PASS for both integration cases. The scratch fixture begins without the managed bridge, `run_project` installs it, the bridge connects, and all existing runtime operations remain functional.

If the local execution environment has no Godot binary, confirm the suite remains correctly skipped without `GODOT_RUNTIME_INTEGRATION_TEST` and rely on the existing CI/manual runtime environment for the gated run; do not weaken or remove the gated test.

- [ ] **Step 3: Update README runtime setup to the zero-manual-install flow**

Replace the current Runtime Control Setup sequence with:

```markdown
### Runtime Control Setup

The Codex/MCP package already ships the managed runtime bridge assets. No separate addon download is required.

1. Start the game with `run_project` and `runtimeControl: true`.
2. The server automatically installs, repairs, or updates `addons/godot_mcp_runtime/` before launch.
3. Use `get_runtime_state`, `find_node`, `invoke_node_action`, `change_scene`, and `capture_screenshot` against the running session.

For explicit maintenance, use `ensure_runtime_bridge`, `get_runtime_bridge_status`, or `uninstall_runtime_bridge`.
```

Also state that `runtimeControl: false` does not install or modify the bridge.

- [ ] **Step 4: Refresh the README Cline `autoApprove` list**

Make the list match the post-change server surface. It must include the existing project, scene/resource, asset reimport, TileMap/TileSet, runtime-control, screenshot, and three bridge-management tools, including:

```text
ensure_runtime_bridge
get_runtime_bridge_status
uninstall_runtime_bridge
reimport_asset
create_tilemap
create_tileset
set_tilemap_source
paint_tiles
paint_tiles_to_layer
add_tileset_source
read_tilemap
read_tilemap_layer_used_cells
read_tileset
```

Remove `install_runtime_bridge` and `update_runtime_bridge`. Preserve all other currently registered tool names.

- [ ] **Step 5: Amend the runtime-control design spec installation sections**

Update `docs/superpowers/specs/2026-04-27-runtime-control-design.md` so it says:

- normal runtime-controlled launch automatically ensures the managed addon;
- `ensure_runtime_bridge` is the single explicit install/repair/update lifecycle tool;
- status and uninstall remain separate;
- the session flow begins with MCP ensuring the bridge before opening/replacing the controlled runtime session;
- missing/stale bridge state during `run_project` is repaired automatically;
- only inability to prepare the bridge is a launch error;
- the selected managed-addon architecture, localhost TCP transport, auth, version matching, addon path, and runtime command surface are unchanged.

Do not rewrite unrelated historical design sections.

- [ ] **Step 6: Run docs-sensitive tool-registration and integration-unit coverage**

Run:

```bash
npx vitest run src/tool-handlers.runtime.spec.ts src/runtime-control-manager.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit integration and documentation changes**

```bash
git add src/runtime-control.integration.spec.ts README.md docs/superpowers/specs/2026-04-27-runtime-control-design.md
git commit -m "docs: simplify runtime bridge setup"
```

---

### Task 5: Full verification and single-PR readiness

**Files:**
- Verify all files modified in Tasks 1-4.

**Interfaces:**
- Consumes: complete task implementation.
- Produces: one reviewable PR whose runtime-control setup requires no manual addon installation step.

- [ ] **Step 1: Run TypeScript typecheck**

```bash
npm run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: PASS, with generated runtime bridge assets still present under `build/scripts/` and version-stamped from `package.json` as before.

- [ ] **Step 3: Run the complete Vitest suite**

```bash
npm test
```

Expected: PASS, with the Godot-gated integration suite skipped unless its environment variables are enabled.

- [ ] **Step 4: Confirm removed tool names do not remain in executable/docs surfaces**

Run:

```bash
git grep -n "install_runtime_bridge\|update_runtime_bridge" -- ':!docs/superpowers/plans/2026-04-27-runtime-control.md'
```

Expected: no matches in current implementation, README, or current design spec. The old 2026-04-27 implementation plan may retain historical references and is intentionally excluded rather than rewritten.

- [ ] **Step 5: Confirm the new tool and launch path are represented consistently**

Run:

```bash
git grep -n "ensure_runtime_bridge\|ensureBridge" src README.md docs/superpowers/specs/2026-04-27-runtime-control-design.md
```

Expected: matches in manager contract/implementation, handler/server registration/tests, README, and amended design spec.

- [ ] **Step 6: Review the final diff for scope**

Run:

```bash
git diff main...HEAD --stat
git diff main...HEAD
```

Expected: changes are limited to runtime bridge lifecycle/launch behavior, tests, README/spec documentation, and this plan. No transport, screenshot protocol, TileMap implementation, package identity, or unrelated refactor is present.

- [ ] **Step 7: Create or update one PR for the whole task**

Use the existing `feat/runtime-bridge-auto-ensure` branch and one PR with a summary equivalent to:

```markdown
## Summary
- auto-install/repair/update the managed runtime bridge when runtime control is requested
- replace separate install/update MCP tools with idempotent `ensure_runtime_bridge`
- preserve preflight ordering so failed bridge preparation does not stop an existing game
- prove zero-setup runtime launch and align runtime-control docs

## Verification
- `npm run typecheck`
- `npm run build`
- `npm test`
- gated `src/runtime-control.integration.spec.ts` run when Godot is available
```

Do not create a second PR for docs or cleanup.

---

## Plan Self-Review

### Spec coverage

- Managed addon architecture/path/autoload/version behavior: preserved in Task 1 and Task 4.
- Automatic preparation before runtime launch: Task 2.
- Failure before active-process replacement: Task 2 regression coverage.
- Explicit maintenance tooling: Task 3.
- No backward-compatibility aliases: Global Constraints and Task 3.
- End-to-end clean-project launch: Task 4.
- README and design-spec consistency: Task 4.
- Full build/test and single-PR scope: Task 5.

### Scope exclusions

The plan intentionally does not change runtime TCP framing/authentication, screenshot capture/persistence, node-action allowlisting, scene-transition protocol, TileMap/TileSet operations, npm/Codex plugin packaging, or Godot asset-library distribution. The existing npm package already carries the runtime bridge assets, so adding another addon distribution mechanism would duplicate packaging without improving the target workflow.
