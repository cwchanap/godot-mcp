# Godot Agent Plugin

[![](https://badge.mcpx.dev?type=server 'MCP Server')](https://modelcontextprotocol.io/introduction)
[![Made with Godot](https://img.shields.io/badge/Made%20with-Godot-478CBF?style=flat&logo=godot%20engine&logoColor=white)](https://godotengine.org)
[![](https://img.shields.io/badge/Node.js-339933?style=flat&logo=nodedotjs&logoColor=white 'Node.js')](https://nodejs.org/en/download/)
[![](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white 'TypeScript')](https://www.typescriptlang.org/)

[![](https://img.shields.io/github/last-commit/cwchanap/godot-agent-plugin 'Last Commit')](https://github.com/cwchanap/godot-agent-plugin/commits/main)
[![](https://img.shields.io/github/stars/cwchanap/godot-agent-plugin 'Stars')](https://github.com/cwchanap/godot-agent-plugin/stargazers)
[![](https://img.shields.io/github/forks/cwchanap/godot-agent-plugin 'Forks')](https://github.com/cwchanap/godot-agent-plugin/network/members)
[![](https://img.shields.io/npm/v/%40cwchanap%2Fgodot-plugin 'npm')](https://www.npmjs.com/package/@cwchanap/godot-plugin)
[![](https://img.shields.io/badge/License-MIT-red.svg 'MIT License')](https://opensource.org/licenses/MIT)

This repository is maintained by `cwchanap` as a fork of [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp), originally created by Solomon Elias. This fork is distributed as the Codex plugin `godot-plugin` and the npm package [`@cwchanap/godot-plugin`](https://www.npmjs.com/package/@cwchanap/godot-plugin), with the original MIT license and attribution preserved.

```text
                           (((((((             (((((((
                        (((((((((((           (((((((((((
                        (((((((((((((       (((((((((((((
                        (((((((((((((((((((((((((((((((((
                        (((((((((((((((((((((((((((((((((
         (((((      (((((((((((((((((((((((((((((((((((((((((      (((((
       (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((
     ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((
    ((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((
      (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((
        (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((
         (((((((((((@@@@@@@(((((((((((((((((((((((((((@@@@@@@(((((((((((
         (((((((((@@@@,,,,,@@@(((((((((((((((((((((@@@,,,,,@@@@(((((((((
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((
         ((((((((@@@,,,,,,,,,@@(((((((@@@@@(((((((@@,,,,,,,,,@@@((((((((
         (((((((((@@@,,,,,,,@@((((((((@@@@@((((((((@@,,,,,,,@@@(((((((((
         ((((((((((((@@@@@@(((((((((((@@@@@(((((((((((@@@@@@((((((((((((
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((
         (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((
         @@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@((((((((((((@@@@@@@@@@@@@
         ((((((((( @@@(((((((((((@@(((((((((((@@(((((((((((@@@ (((((((((
         (((((((((( @@((((((((((@@@(((((((((((@@@((((((((((@@ ((((((((((
          (((((((((((@@@@@@@@@@@@@@(((((((((((@@@@@@@@@@@@@@(((((((((((
           (((((((((((((((((((((((((((((((((((((((((((((((((((((((((((
              (((((((((((((((((((((((((((((((((((((((((((((((((((((
                 (((((((((((((((((((((((((((((((((((((((((((((((
                        (((((((((((((((((((((((((((((((((


                          /$$      /$$  /$$$$$$  /$$$$$$$
                         | $$$    /$$$ /$$__  $$| $$__  $$
                         | $$$$  /$$$$| $$  \__/| $$  \ $$
                         | $$ $$/$$ $$| $$      | $$$$$$$/
                         | $$  $$$| $$| $$      | $$____/
                         | $$\  $ | $$| $$    $$| $$
                         | $$ \/  | $$|  $$$$$$/| $$
                         |__/     |__/ \______/ |__/
```

A Codex plugin and Model Context Protocol (MCP) server for interacting with the Godot game engine.

## Introduction

Godot Agent Plugin packages the Godot MCP server for Codex and other MCP-compatible agents. It can launch the Godot editor, run projects, capture debug output, author project resources, and control a running game through a managed runtime bridge. This direct feedback loop helps agents understand what works and what doesn't in real Godot projects, leading to better code generation and debugging assistance.

## Features

- **Launch Godot Editor**: Open the Godot editor for a specific project
- **Run Godot Projects**: Execute Godot projects in debug mode
- **Capture Debug Output**: Retrieve console output and error messages
- **Control Execution**: Start and stop Godot projects programmatically
- **Get Godot Version**: Retrieve the installed Godot version
- **List Godot Projects**: Find Godot projects in a specified directory
- **Project Analysis**: Get detailed information about project structure
- **Runtime Bridge Management**:
  - Automatically install, repair, or update the managed bridge when runtime control is requested
  - Explicitly ensure, inspect, or remove the managed runtime bridge addon
- **Runtime Control**:
  - Inspect runtime state for the active game session
  - Find live nodes by path in the running scene tree
  - Invoke supported button-like actions on live nodes
  - Change scenes in a running game
  - Capture the active game's rendered root viewport as a PNG image
- **Scene Management**:
  - Create new scenes with specified root node types
  - Add nodes to existing scenes with customizable properties
  - Load sprites and textures into Sprite2D nodes
  - Export 3D scenes as MeshLibrary resources for GridMap
  - Save scenes with options for creating variants
- **UID Management** (for Godot 4.4+):
  - Get UID for specific files
  - Update UID references by resaving resources
- **TileMap and TileSet Authoring**:
  - Create TileMap nodes and TileSet resources
  - Add atlas texture sources and assign TileSets
  - Paint and inspect TileMap and TileMapLayer cells

## Available Tools

The server currently exposes 32 MCP tools.

### Project and Process

| Tool | Purpose |
|------|---------|
| `launch_editor` | Launch the Godot editor for a project |
| `run_project` | Run a project and capture its output |
| `get_debug_output` | Read current debug output and errors |
| `stop_project` | Stop the currently running project |
| `get_godot_version` | Report the installed Godot version |
| `list_projects` | Find Godot projects under a directory |
| `get_project_info` | Retrieve metadata about a Godot project |

### Runtime Bridge and Live Game Control

| Tool | Purpose |
|------|---------|
| `ensure_runtime_bridge` | Install, repair, or update the managed runtime bridge |
| `get_runtime_bridge_status` | Inspect the bridge installed in a project |
| `uninstall_runtime_bridge` | Remove the managed runtime bridge |
| `get_runtime_state` | Inspect the active runtime bridge session |
| `find_node` | Find a node in the running scene tree |
| `change_scene` | Request a scene transition in the running project |
| `invoke_node_action` | Invoke an allowlisted action on a live node |
| `capture_screenshot` | Capture the latest rendered game frame |

### Scene and Asset Authoring

| Tool | Purpose |
|------|---------|
| `create_scene` | Create a Godot scene file |
| `add_node` | Add a node to an existing scene |
| `load_sprite` | Load a texture into a Sprite2D node |
| `export_mesh_library` | Export a scene as a MeshLibrary resource |
| `save_scene` | Save changes to a scene file |
| `reimport_asset` | Re-import assets through Godot's importer pipeline |

### UID Management

| Tool | Purpose |
|------|---------|
| `get_uid` | Get a file UID in Godot 4.4+ |
| `update_project_uids` | Update UID references by resaving project resources |

### TileMap and TileSet Authoring

| Tool | Purpose |
|------|---------|
| `create_tilemap` | Create a TileMap node in a scene |
| `create_tileset` | Create a TileSet resource |
| `set_tilemap_source` | Assign a TileSet resource to a TileMap |
| `paint_tiles` | Paint cells on a TileMap |
| `paint_tiles_to_layer` | Paint cells on a TileMapLayer |
| `add_tileset_source` | Add a texture source to a TileSet |
| `read_tilemap` | Read TileMap data and tile usage |
| `read_tilemap_layer_used_cells` | Read used TileMapLayer cells with tile details |
| `read_tileset` | Read TileSet sources and atlas metadata |

## Requirements

- [Godot Engine](https://godotengine.org/download) installed on your system
- Node.js (>=18.18) and npm
- An AI agent that supports MCP

## Quick Start

### Codex Plugin

The Codex wrapper uses the published `@cwchanap/godot-plugin` version pinned in `plugins/godot-plugin/.mcp.json`.

Add this repository as a marketplace and install the plugin:

```bash
codex plugin marketplace add cwchanap/godot-agent-plugin
codex plugin add godot-plugin@cwchanap
```

Start a new Codex task after installation so the `mcp__godot__*` tools are loaded. If Godot is not discovered automatically, set `GODOT_PATH` in the environment that launches Codex and reopen the task.

The npm-based client examples below use the published `@cwchanap/godot-plugin` package.

### Claude Code

```bash
claude mcp add godot -- npx @cwchanap/godot-plugin
```

Restart Claude Code after adding the server so the Godot MCP tools are loaded.

With environment variables:

```bash
claude mcp add godot -e GODOT_PATH=/path/to/godot -e DEBUG=true -- npx @cwchanap/godot-plugin
```

<details>
<summary><strong>Cline</strong></summary>

Add to your Cline MCP settings file (`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["@cwchanap/godot-plugin"],
      "env": {
        "DEBUG": "true"
      },
      "disabled": false,
      "autoApprove": [
        "launch_editor",
        "run_project",
        "get_debug_output",
        "stop_project",
        "ensure_runtime_bridge",
        "get_runtime_bridge_status",
        "uninstall_runtime_bridge",
        "get_runtime_state",
        "find_node",
        "change_scene",
        "invoke_node_action",
        "capture_screenshot",
        "get_godot_version",
        "list_projects",
        "get_project_info",
        "create_scene",
        "add_node",
        "load_sprite",
        "export_mesh_library",
        "save_scene",
        "reimport_asset",
        "get_uid",
        "update_project_uids",
        "create_tilemap",
        "create_tileset",
        "set_tilemap_source",
        "paint_tiles",
        "paint_tiles_to_layer",
        "add_tileset_source",
        "read_tilemap",
        "read_tilemap_layer_used_cells",
        "read_tileset"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

**Using the Cursor UI:**

1. Go to **Cursor Settings** > **Features** > **MCP**
2. Click on the **+ Add New MCP Server** button
3. Fill out the form:
   - Name: `godot`
   - Type: `command`
   - Command: `npx @cwchanap/godot-plugin`
4. Click "Add"
5. You may need to press the refresh button in the top right corner of the MCP server card to populate the tool list

**Using Project-Specific Configuration:**

Create a file at `.cursor/mcp.json` in your project directory:

```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["@cwchanap/godot-plugin"],
      "env": {
        "DEBUG": "true"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Other MCP Clients</strong></summary>

For any MCP-compatible client, use this configuration:

```json
{
  "mcpServers": {
    "godot": {
      "command": "npx",
      "args": ["@cwchanap/godot-plugin"],
      "env": {
        "GODOT_PATH": "/path/to/godot",
        "DEBUG": "true"
      }
    }
  }
}
```

</details>

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GODOT_PATH` | Path to the Godot executable (overrides automatic detection) |
| `DEBUG` | Set to `"true"` to enable detailed server-side debug logging |

<details>
<summary><strong>Building from Source</strong></summary>

```bash
git clone https://github.com/cwchanap/godot-agent-plugin.git
cd godot-agent-plugin
npm install
npm run build
```

Then point your MCP client to this checkout's `build/index.js` instead of using `npx`.

</details>

### Argument Configuration

When running the built CLI directly or through an MCP host that supports `argumentConfig`, configuration can be passed without changing environment variables:

- Set the Godot path: `node build/index.js --godot-path /absolute/path/to/Godot`
- Pass JSON: `node build/index.js --config '{"godotPath":"/absolute/path/to/Godot"}'`
- Use an empty string or `null` for `godotPath` to clear a cached path and fall back to automatic detection
- MCP hosts can send the same JSON through `MCP_ARGUMENT_CONFIG`, `MCP_SERVER_ARGUMENT_CONFIG`, or `MCP_CONFIG`

### Runtime Control Setup

Runtime control requires the managed runtime bridge addon in the target project, but there is no separate setup step for normal use:

1. Start the game with `run_project` and `runtimeControl: true`.
2. The server automatically installs a missing bridge, repairs a partial install, or updates an incompatible bridge before replacing any existing game process.
3. Use `get_runtime_state`, `find_node`, `invoke_node_action`, `change_scene`, and `capture_screenshot` against the running session.

For explicit maintenance, use `ensure_runtime_bridge` to prepare the bridge without launching the game, `get_runtime_bridge_status` to inspect it, or `uninstall_runtime_bridge` to remove it.

A normal `run_project` call without `runtimeControl: true` does not install or modify the runtime bridge.

### Runtime Screenshot Capture

`capture_screenshot` requires an active rendered game session started with runtime control and a compatible managed runtime bridge. A runtime-controlled launch automatically ensures the bridge is current before the game starts. It returns the latest available root-viewport frame, including when the render loop is paused; if the viewport has not produced a usable frame yet, retry after rendering starts. Headless sessions cannot capture screenshots.

The tool always returns the captured `image/png`, even when an optional persistence write fails. The input is closed: use `{}` to return the image without saving, or choose one managed destination:

```json
{}
```

```json
{ "saveTo": "temporary" }
```

```json
{ "saveTo": "project" }
```

Temporary captures use a per-server managed directory beneath the operating system's temporary directory and are removed on normal server shutdown. Project captures use the authenticated active project path, which is fixed rather than caller-supplied; they are written as unique non-overwriting PNGs beneath `.godot-mcp/captures/`, with `.godot-mcp/.gdignore` created and symlink escapes refused. Project captures persist until removed. Callers cannot provide paths or filenames. PNG captures are limited to 16 MiB.


## Architecture

The Godot MCP server uses a bundled GDScript approach for complex operations:

1. **Direct Commands**: Simple operations like launching the editor or getting project info use Godot's built-in CLI commands directly.
2. **Bundled Operations Script**: Complex operations like creating scenes or adding nodes use a single, comprehensive GDScript file (`godot_operations.gd`) that handles all operations.

The bundled script accepts operation type and parameters as JSON, allowing for flexible and dynamic operation execution without generating temporary files for each operation.

## Troubleshooting

- **Godot Not Found**: Set the `GODOT_PATH` environment variable to your Godot executable path
- **Connection Issues**: Ensure the server is running and restart your AI assistant
- **Invalid Project Path**: Ensure the path points to a directory containing a `project.godot` file
- **Runtime Bridge Setup**: If automatic bridge preparation fails, verify the project is writable or call `ensure_runtime_bridge` directly to see the setup error
- **Build Issues**: Make sure all dependencies are installed by running `npm install`

<details>
<summary><strong>Cursor-Specific Issues</strong></summary>

- Ensure the MCP server shows up and is enabled in Cursor settings (Settings > MCP)
- MCP tools can only be run using the Agent chat profile (Cursor Pro or Business subscription)
- Use "Yolo Mode" to automatically run MCP tool requests

</details>

## Attribution

This repository is a maintained fork of [Coding-Solo/godot-mcp](https://github.com/Coding-Solo/godot-mcp), originally created by Solomon Elias. The fork is maintained and published by `cwchanap` as `godot-plugin` for Codex and `@cwchanap/godot-plugin` on npm. The original copyright notice and MIT license are preserved in [LICENSE](LICENSE).

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
