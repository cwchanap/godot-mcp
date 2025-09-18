# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

- **Build**: `npm run build` - Compiles TypeScript and copies GDScript files to build directory
- **Watch**: `npm run watch` - Continuously rebuilds on file changes during development
- **MCP Inspector**: `npm run inspector` - Interactive debugging tool for MCP server testing
- **Prepare**: `npm run prepare` - Runs build as part of npm lifecycle (auto-runs on install)

## Project Architecture

This is an MCP (Model Context Protocol) server that enables AI assistants to interact with the Godot game engine. The architecture follows a hybrid approach:

### Core Components

1. **MCP Server** (`src/index.ts`): Main TypeScript server implementing the MCP protocol
   - Handles tool registration and execution
   - Manages Godot process lifecycle
   - Provides error handling and validation

2. **Bundled GDScript Operations** (`src/scripts/godot_operations.gd`):
   - Single comprehensive GDScript file handling complex Godot operations
   - Accepts operation type and parameters as JSON
   - Eliminates need for temporary script files
   - Operations include scene creation, node management, sprite loading, mesh library export, UID management, TileMap/TileSet editing and inspection

### Execution Patterns

- **Direct CLI Commands**: Simple operations (launch editor, get version, list projects) use Godot's built-in CLI directly
- **Bundled Script Operations**: Complex operations (create scenes, add nodes, save scenes) execute through the centralized GDScript file
- **Process Management**: Server maintains references to running Godot processes for output capture and control

### Build Process

The custom build script (`scripts/build.js`) performs:
- TypeScript compilation via `tsc`
- Makes `build/index.js` executable with chmod 755
- Copies `godot_operations.gd` from src to build directory
- Ensures proper file permissions for MCP server execution

### Key Features

- **Cross-platform Godot path detection**: Automatically locates Godot executable
- **Debug output capture**: Captures and provides access to Godot console output
- **Scene management**: Create scenes, add nodes with properties, load sprites
- **UID management**: Handle Godot 4.4+ UID system for resource references
- **MeshLibrary export**: Export 3D scenes for GridMap usage
- **TileMap & TileSet tooling**: Create, configure, paint, and read TileMap data as well as inspect TileSet atlas sources directly from MCP tools
- **Project analysis**: Analyze project structure and provide metadata

### Environment Variables

- `GODOT_PATH`: Override automatic Godot executable detection
- `DEBUG`: Enable detailed server-side logging when set to "true"

## Project Structure

```
src/
├── index.ts              # Main MCP server implementation
└── scripts/
    └── godot_operations.gd # Bundled GDScript for complex operations

build/                    # Compiled output (generated)
├── index.js             # Compiled server (executable)
└── scripts/
    └── godot_operations.gd # Copied GDScript file

scripts/
└── build.js             # Custom build script for post-compilation steps
```

## Testing

Use the MCP Inspector for interactive testing:
```bash
npm run inspector
```

This launches a web interface for testing MCP tools and debugging server behavior.
