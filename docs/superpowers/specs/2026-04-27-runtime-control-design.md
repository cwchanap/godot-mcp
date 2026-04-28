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

## Non-Goals

- Generic arbitrary GDScript injection into a running game
- Full editor remote-debugger automation
- Broad low-level mouse/keyboard replay in the first release
- Support for controlling completely unmodified projects with no installed addon
- Covering every possible node type interaction in v1

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
   - installs, updates, removes, and checks the runtime addon
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

The runtime bridge is shipped as a versioned addon managed by `godot-mcp`.

### Default behavior

- Install into the target project as a **managed local-only addon**
- Do not assume the addon is committed to source control
- Make it easy for users to commit it later if they want shared team setup

### Lifecycle tools

- `install_runtime_bridge`
- `get_runtime_bridge_status`
- `update_runtime_bridge`
- `uninstall_runtime_bridge`

### Installation responsibilities

`install_runtime_bridge` must:

- copy addon files into the project
- register exactly one autoload entry in `project.godot`
- record the installed bridge version in a machine-readable way

`get_runtime_bridge_status` must report:

- installed vs missing
- installed version
- compatibility with the current MCP server version

`update_runtime_bridge` must:

- upgrade the installed addon in place
- preserve a valid autoload entry

`uninstall_runtime_bridge` must:

- remove the addon files it installed
- remove the autoload entry it owns
- fail safely if the addon is in use by a running session

## Runtime Session Flow

### Launch and connect

1. The user installs the runtime bridge for a project.
2. The user starts a project with runtime control enabled.
3. `godot-mcp` launches a local-only runtime control endpoint from inside the existing server process.
4. `godot-mcp` starts Godot and passes user args after `--`, including:
   - ephemeral port or endpoint information
   - short-lived session token
   - optional session identifier
5. The addon reads the user args at startup.
6. The addon connects back to the MCP runtime endpoint and sends:
   - bridge version
   - project identity
   - runtime session identity
   - current scene metadata if available
7. `RuntimeControlManager` marks the session connected and available for runtime tool calls.

### Command flow

1. An MCP runtime tool is called.
2. The MCP server validates that a compatible bridge is connected for the active project session.
3. The request is serialized into a small JSON command.
4. The addon executes the command inside the live game.
5. The addon returns structured JSON success or error data.
6. The MCP server maps the result into the MCP tool response.

## Runtime Tool Surface

### Bridge management tools

- `install_runtime_bridge`
- `get_runtime_bridge_status`
- `update_runtime_bridge`
- `uninstall_runtime_bridge`

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

- **bridge not installed**
  - instruct user to run `install_runtime_bridge`

- **bridge version mismatch**
  - instruct user to run `update_runtime_bridge`

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

- bridge install/status/update/remove logic
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

- runtime bridge install/update/remove
- runtime handshake after launch
- `get_runtime_state`
- `find_node` against known paths
- `invoke_node_action` for a simple button target
- `change_scene` to a known scene
- clear errors for missing addon, disconnected bridge, and invalid node path

## Rollout Plan

### Phase 1

- bridge install/status/update/remove
- runtime handshake and connection tracking
- `get_runtime_state`
- `find_node`
- `change_scene`

### Phase 2

- `invoke_node_action` for a narrow allowlisted set of UI-oriented node types

### Phase 3

- optional evaluation of low-level input simulation only if needed after the semantic runtime path is stable

## Why This Scope Is Appropriate

This spec covers one cohesive subsystem: **runtime control of a running Godot project through a managed in-project addon**. It does not attempt to solve unrelated editor automation or broad gameplay scripting. The scope is intentionally narrow enough to support a single implementation plan while still delivering meaningful new capability.
