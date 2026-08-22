# Runtime Control Design

## Problem

`godot-mcp` can currently launch projects, run a selected scene, capture debug output, and edit project assets and scenes. It cannot control a live running game instance in a semantic way. In particular, it has no supported path for:

- targeting a node in the running `SceneTree` by path
- invoking a button-like action on that node
- requesting an in-game scene transition in the running process

The goal of this design is to add a reliable runtime-control foundation without depending on editor-only debugger UI flows or brittle raw input simulation.

## Goals

- Add a scalable way for `godot-mcp` to control a running Godot game instance.
- Support semantic runtime operations before low-level input simulation.
- Provide first-class scene transition support for a running project.
- Keep the MCP-side implementation inside the existing Node/TypeScript server process.
- Use a managed runtime addon installed into the target Godot project.
- Default to a local-only managed install, with the option for teams to commit the addon if they want shared reproducibility.
- Make a runtime-controlled launch self-preparing: install, repair, or update the managed addon automatically when needed.

## Non-Goals

- Generic arbitrary GDScript injection into a running game
- Full editor remote-debugger automation
- Broad low-level mouse/keyboard replay in the first release
- Support for controlling completely unmodified projects without allowing the managed addon to be installed
- Covering every possible node type interaction in v1
- A separate package manager or editor-plugin installation flow for the runtime bridge

## Selected Approach

Use a **managed GDScript runtime addon** installed into the Godot project and a **runtime control manager** inside the existing MCP server process.

The runtime addon runs inside the launched game process and is the only component allowed to touch the live `SceneTree`. The MCP server remains the entry point for all tools, owns addon lifecycle management, starts a local-only runtime control endpoint, and routes semantic runtime commands to the connected game session.

This approach is preferred over low-level input replay or debugger-dependent inspection because it is:

- more reliable for node-path targeting
- explicit and versionable
- compatible with the current `godot-mcp` architecture
- easier to scope and test incrementally

## High-Level Architecture

There are three primary pieces:

1. **Existing MCP server process**
   - registers MCP tools
   - launches and stops Godot projects
   - captures stdout/stderr

2. **RuntimeControlManager** inside the MCP server
   - ensures, removes, and checks the runtime addon
   - starts and owns the local runtime control endpoint for a launched session
   - tracks live bridge connection state
   - validates session tokens and bridge version compatibility
   - routes runtime tool requests to the running game

3. **Managed GDScript runtime addon** inside the Godot project
   - installed into the project as a local-only managed addon by default
   - registered as an autoload
   - reads launch arguments provided by `godot-mcp`
   - connects back to the MCP runtime endpoint
   - resolves node paths, reports runtime state, invokes supported node actions, and changes scenes

The only separated artifact is the installed GDScript addon inside the project. There is no second standalone runtime-control program outside the MCP server.

## Installation Model

The runtime bridge is shipped inside the versioned MCP package and managed by `godot-mcp`.

### Default behavior

- Install into the target project as a **managed local-only addon** only when runtime control is requested or `ensure_runtime_bridge` is called explicitly.
- `run_project` with `runtimeControl: true` automatically ensures a compatible bridge before replacing an existing game process.
- A missing or partial bridge is installed/repaired automatically.
- An installed but incompatible bridge is updated automatically.
- An already compatible bridge is left unchanged.
- A normal `run_project` call without runtime control does not install or modify the addon.
- Do not assume the addon is committed to source control; teams may commit it later if they want shared reproducibility.

### Lifecycle tools

- `ensure_runtime_bridge`
- `get_runtime_bridge_status`
- `uninstall_runtime_bridge`

### Installation responsibilities

`ensure_runtime_bridge` and the launch-time ensure path must:

- inspect current bridge state first
- copy managed addon files into the project when missing, partial, or incompatible
- register exactly one canonical autoload entry in `project.godot`
- record the installed bridge version in a machine-readable way
- return the post-ensure bridge state
- distinguish whether preparation installed, updated, or left the bridge unchanged

`get_runtime_bridge_status` must report without mutating the project:

- installed vs missing
- installed version
- compatibility with the current MCP server version

`uninstall_runtime_bridge` must:

- remove the addon files it installed
- remove the autoload entry it owns
- fail safely if the addon is in use by a running session for that project

### Launch ordering guarantee

Bridge preparation happens before an existing Godot process is stopped or replaced. If install/repair/update fails, `run_project` returns the preparation error and leaves the currently running game and runtime session untouched.

## Runtime Session Flow

### Launch and connect

1. The user starts a project with `run_project` and `runtimeControl: true`.
2. `godot-mcp` ensures the target project has a compatible managed runtime bridge.
3. If preparation fails, the launch stops before any existing process/session is replaced.
4. Once preparation succeeds, `godot-mcp` replaces any existing managed game process/session as needed.
5. `godot-mcp` launches a local-only runtime control endpoint from inside the existing server process.
6. `godot-mcp` starts Godot and passes user args after `--`, including:
   - ephemeral port or endpoint information
   - short-lived session token
   - optional session identifier
7. The addon reads the user args at startup.
8. The addon connects back to the MCP runtime endpoint and sends:
   - bridge version
   - project identity
   - runtime session identity
   - current scene metadata if available
9. `RuntimeControlManager` marks the session connected and available for runtime tool calls.

### Command flow

1. An MCP runtime tool is called.
2. The MCP server validates that a compatible bridge is connected for the active project session.
3. The request is serialized into a small JSON command.
4. The addon executes the command inside the live game.
5. The addon returns structured JSON success or error data.
6. The MCP server maps the result into the MCP tool response.

## Runtime Tool Surface

### Bridge management tools

- `ensure_runtime_bridge`
  - installs a missing bridge
  - repairs a partial managed install
  - updates an incompatible installed bridge
  - leaves a compatible bridge unchanged

- `get_runtime_bridge_status`
  - reads bridge installation/version/compatibility state without modifying the project

- `uninstall_runtime_bridge`
  - removes the managed bridge when it is not in use by an active session for that project

### Runtime control tools

- `get_runtime_state`
  - reports whether a project is running
  - reports whether the runtime bridge is connected
  - reports the active scene if known

- `find_node`
  - validates a node path against the live `SceneTree`
  - returns basic metadata such as node name and type

- `invoke_node_action`
  - performs a semantic action on a supported node at a given path
  - v1 focuses on obvious UI-style actions rather than arbitrary node mutation

- `change_scene`
  - requests a scene transition in the running game
  - accepts a scene path and returns the result of the transition request

- `capture_screenshot`
  - captures the latest usable rendered root-viewport frame from the running game

## Supported Runtime Actions in v1

`invoke_node_action` should remain deliberately narrow in the first release.

Initial support:

- `BaseButton`-style press/activate behavior

Not in v1:

- broad generic method execution against arbitrary nodes
- arbitrary property mutation
- full mouse/keyboard emulation

This keeps the first release semantic and reliable instead of pretending all node types can be controlled uniformly.

## Addon Responsibilities

The addon must expose a narrow, stable command surface. It is not a general remote code execution channel.

Responsibilities:

- parse runtime launch arguments
- establish a local authenticated connection to the MCP runtime endpoint
- report bridge version and connection status
- resolve live node paths
- collect minimal runtime metadata
- dispatch a small allowlisted set of supported actions
- request scene transitions using the project runtime context
- return rendered screenshot payloads when requested

The addon should avoid owning unrelated gameplay logic. It exists only to bridge the running project to MCP runtime control.

## Transport and Security

The runtime control channel should be:

- **localhost-only**
- **session-scoped**
- protected by a **short-lived token**

Required protections:

- reject connections with invalid or expired tokens
- reject bridge requests before handshake completion
- reject version-incompatible clients
- reject unsupported actions explicitly

The design should not rely on arbitrary script strings sent over the wire.

## Error Handling

All runtime-control failures should return explicit structured errors. No silent no-ops.

Expected cases:

- **bridge preparation fails**
  - return the filesystem/configuration failure from the automatic ensure path
  - do not stop or replace an existing running game/session
  - allow `ensure_runtime_bridge` to be called explicitly for the same diagnostic path

- **bridge version mismatch during handshake**
  - reject the connection because the running bridge is not the version that was prepared for the session

- **project running but bridge not connected**
  - report disconnected runtime state

- **node path not found**
  - return requested path and current scene when available

- **unsupported action for node type**
  - return supported actions for that target type when available

- **scene transition failure**
  - return target scene path and the engine-reported failure reason

- **connection lost during session**
  - mark the runtime session disconnected
  - make subsequent runtime calls fail fast with reconnect-required messaging

## Testing Strategy

### TypeScript tests

Add coverage for:

- bridge ensure/status/remove logic
- ensure action classification: installed, updated, unchanged
- partial-install and autoload repair behavior
- runtime-controlled launch auto-ensure ordering
- preparation failure preserving an existing running process/session
- normal launch not mutating bridge state
- session handshake state transitions
- token validation
- version compatibility checks
- request routing and response mapping
- structured error conversion

### GDScript addon tests

Add coverage where practical for:

- launch arg parsing
- handshake payload construction
- node path lookup helpers
- action dispatch allowlisting

### Integration tests

Use the sample Godot project to verify:

- a clean fixture can start directly with `runtimeControl: true` without a separate install call
- the bridge reports installed and compatible after the controlled launch
- runtime handshake after launch
- `get_runtime_state`
- `find_node` against known paths
- `invoke_node_action` for a simple button target
- `change_scene` to a known scene
- screenshot capture behavior
- clear errors for disconnected bridge and invalid node path

## Rollout Plan

### Phase 1

- idempotent bridge ensure/status/remove
- automatic bridge preparation during controlled launch
- runtime handshake and connection tracking
- `get_runtime_state`
- `find_node`
- `change_scene`

### Phase 2

- `invoke_node_action` for a narrow allowlisted set of UI-oriented node types

### Phase 3

- screenshot capture and optional evaluation of low-level input simulation only if needed after the semantic runtime path is stable

## Why This Scope Is Appropriate

This spec covers one cohesive subsystem: **runtime control of a running Godot project through a managed in-project addon**. Automatic bridge preparation removes a setup step without adding a new installer architecture: it reuses the existing managed addon lifecycle and keeps project mutation limited to runtime-control use. The scope remains focused on runtime control rather than unrelated editor automation or broad gameplay scripting.
