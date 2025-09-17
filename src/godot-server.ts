/**
 * Core Godot MCP Server implementation
 */

import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { GodotServerConfig } from './types.js';
import { GodotPathManager } from './godot-path.js';
import { OperationExecutor } from './operation-executor.js';
import { ToolHandlers } from './tool-handlers.js';

// Derive __filename and __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class GodotServer {
  private server: Server;
  private pathManager: GodotPathManager;
  private operationExecutor: OperationExecutor;
  private toolHandlers: ToolHandlers;

  constructor(config?: GodotServerConfig) {
    // Initialize path manager
    this.pathManager = new GodotPathManager({
      strictPathValidation: config?.strictPathValidation,
      initialPath: config?.godotPath
    });

    // Set the path to the operations script
    const operationsScriptPath = join(__dirname, 'scripts', 'godot_operations.gd');

    // Initialize operation executor
    this.operationExecutor = new OperationExecutor(operationsScriptPath);

    // Initialize tool handlers
    this.toolHandlers = new ToolHandlers(this.pathManager, this.operationExecutor);

    // Initialize the MCP server
    this.server = new Server(
      {
        name: 'godot-mcp',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Set up tool handlers
    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);

    // Cleanup on exit
    process.on('SIGINT', async () => {
      await this.cleanup();
      process.exit(0);
    });
  }

  /**
   * Clean up resources when shutting down
   */
  private async cleanup() {
    if (process.env.DEBUG === 'true') {
      console.debug('[GODOT-SERVER] Cleaning up resources');
    }
    await this.toolHandlers.cleanup();
    await this.server.close();
  }

  /**
   * Set up the tool handlers for the MCP server
   */
  private setupToolHandlers() {
    // Define available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'launch_editor',
          description: 'Launch Godot editor for a specific project',
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
        {
          name: 'run_project',
          description: 'Run the Godot project and capture output',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scene: {
                type: 'string',
                description: 'Optional: Specific scene to run',
              },
            },
            required: ['projectPath'],
          },
        },
        {
          name: 'get_debug_output',
          description: 'Get the current debug output and errors',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'stop_project',
          description: 'Stop the currently running Godot project',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'get_godot_version',
          description: 'Get the installed Godot version',
          inputSchema: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
        {
          name: 'list_projects',
          description: 'List Godot projects in a directory',
          inputSchema: {
            type: 'object',
            properties: {
              directory: {
                type: 'string',
                description: 'Directory to search for Godot projects',
              },
              recursive: {
                type: 'boolean',
                description: 'Whether to search recursively (default: false)',
              },
            },
            required: ['directory'],
          },
        },
        {
          name: 'get_project_info',
          description: 'Retrieve metadata about a Godot project',
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
        {
          name: 'create_scene',
          description: 'Create a new Godot scene file',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path where the scene file will be saved (relative to project)',
              },
              rootNodeType: {
                type: 'string',
                description: 'Type of the root node (e.g., Node2D, Node3D)',
                default: 'Node2D',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        {
          name: 'add_node',
          description: 'Add a node to an existing scene',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              parentNodePath: {
                type: 'string',
                description: 'Path to the parent node (e.g., "root" or "root/Player")',
                default: 'root',
              },
              nodeType: {
                type: 'string',
                description: 'Type of node to add (e.g., Sprite2D, CollisionShape2D)',
              },
              nodeName: {
                type: 'string',
                description: 'Name for the new node',
              },
              properties: {
                type: 'object',
                description: 'Optional properties to set on the node',
              },
            },
            required: ['projectPath', 'scenePath', 'nodeType', 'nodeName'],
          },
        },
        {
          name: 'load_sprite',
          description: 'Load a sprite into a Sprite2D node',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              nodePath: {
                type: 'string',
                description: 'Path to the Sprite2D node (e.g., "root/Player/Sprite2D")',
              },
              texturePath: {
                type: 'string',
                description: 'Path to the texture file (relative to project)',
              },
            },
            required: ['projectPath', 'scenePath', 'nodePath', 'texturePath'],
          },
        },
        {
          name: 'export_mesh_library',
          description: 'Export a scene as a MeshLibrary resource',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (.tscn) to export',
              },
              outputPath: {
                type: 'string',
                description: 'Path where the mesh library (.res) will be saved',
              },
              meshItemNames: {
                type: 'array',
                items: {
                  type: 'string',
                },
                description: 'Optional: Names of specific mesh items to include (defaults to all)',
              },
            },
            required: ['projectPath', 'scenePath', 'outputPath'],
          },
        },
        {
          name: 'save_scene',
          description: 'Save changes to a scene file',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              newPath: {
                type: 'string',
                description: 'Optional: New path to save the scene to (for creating variants)',
              },
            },
            required: ['projectPath', 'scenePath'],
          },
        },
        {
          name: 'get_uid',
          description: 'Get the UID for a specific file in a Godot project (for Godot 4.4+)',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              filePath: {
                type: 'string',
                description: 'Path to the file (relative to project) for which to get the UID',
              },
            },
            required: ['projectPath', 'filePath'],
          },
        },
        {
          name: 'update_project_uids',
          description: 'Update UID references in a Godot project by resaving resources (for Godot 4.4+)',
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
        {
          name: 'create_tilemap',
          description: 'Create a TileMap node in an existing scene',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              tilemapName: {
                type: 'string',
                description: 'Name for the new TileMap node',
              },
              parentNodePath: {
                type: 'string',
                description: 'Path to the parent node (e.g., "root" or "root/GameWorld")',
                default: 'root',
              },
              properties: {
                type: 'object',
                description: 'Optional properties to set on the TileMap node',
              },
            },
            required: ['projectPath', 'scenePath', 'tilemapName'],
          },
        },
        {
          name: 'create_tileset',
          description: 'Create a new TileSet resource',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              tilesetPath: {
                type: 'string',
                description: 'Path where the TileSet resource will be saved (relative to project)',
              },
            },
            required: ['projectPath', 'tilesetPath'],
          },
        },
        {
          name: 'set_tilemap_source',
          description: 'Set the TileSet resource for a TileMap node',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              tilemapPath: {
                type: 'string',
                description: 'Path to the TileMap node (e.g., "root/TileMap")',
              },
              tilesetPath: {
                type: 'string',
                description: 'Path to the TileSet resource (relative to project)',
              },
            },
            required: ['projectPath', 'scenePath', 'tilemapPath', 'tilesetPath'],
          },
        },
        {
          name: 'paint_tiles',
          description: 'Paint tiles on a TileMap',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              scenePath: {
                type: 'string',
                description: 'Path to the scene file (relative to project)',
              },
              tilemapPath: {
                type: 'string',
                description: 'Path to the TileMap node (e.g., "root/TileMap")',
              },
              tiles: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    x: {
                      type: 'integer',
                      description: 'X coordinate of the tile',
                    },
                    y: {
                      type: 'integer',
                      description: 'Y coordinate of the tile',
                    },
                    sourceId: {
                      type: 'integer',
                      description: 'Source ID from the TileSet',
                    },
                    atlasX: {
                      type: 'integer',
                      description: 'X coordinate in the atlas (optional, default 0)',
                    },
                    atlasY: {
                      type: 'integer',
                      description: 'Y coordinate in the atlas (optional, default 0)',
                    },
                    alternativeTile: {
                      type: 'integer',
                      description: 'Alternative tile ID (optional, default 0)',
                    },
                  },
                  required: ['x', 'y', 'sourceId'],
                },
                description: 'Array of tile data to paint',
              },
              layer: {
                type: 'integer',
                description: 'TileMap layer to paint on (default 0)',
                default: 0,
              },
            },
            required: ['projectPath', 'scenePath', 'tilemapPath', 'tiles'],
          },
        },
        {
          name: 'add_tileset_source',
          description: 'Add a texture source to an existing TileSet',
          inputSchema: {
            type: 'object',
            properties: {
              projectPath: {
                type: 'string',
                description: 'Path to the Godot project directory',
              },
              tilesetPath: {
                type: 'string',
                description: 'Path to the TileSet resource (relative to project)',
              },
              texturePath: {
                type: 'string',
                description: 'Path to the texture file (relative to project)',
              },
              sourceId: {
                type: 'integer',
                description: 'Source ID to assign (optional, auto-assigned if not provided)',
              },
              textureRegionSize: {
                type: 'object',
                properties: {
                  x: {
                    type: 'integer',
                    description: 'Width of each tile in pixels',
                  },
                  y: {
                    type: 'integer',
                    description: 'Height of each tile in pixels',
                  },
                },
                required: ['x', 'y'],
                description: 'Size of each tile region in the texture',
              },
              margins: {
                type: 'object',
                properties: {
                  x: {
                    type: 'integer',
                    description: 'Left/right margin in pixels',
                  },
                  y: {
                    type: 'integer',
                    description: 'Top/bottom margin in pixels',
                  },
                },
                required: ['x', 'y'],
                description: 'Margins around the tile atlas',
              },
              separation: {
                type: 'object',
                properties: {
                  x: {
                    type: 'integer',
                    description: 'Horizontal separation between tiles in pixels',
                  },
                  y: {
                    type: 'integer',
                    description: 'Vertical separation between tiles in pixels',
                  },
                },
                required: ['x', 'y'],
                description: 'Separation between tiles in the atlas',
              },
              autoCreateTiles: {
                type: 'boolean',
                description: 'Automatically create tiles based on texture dimensions',
                default: false,
              },
            },
            required: ['projectPath', 'tilesetPath', 'texturePath'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (process.env.DEBUG === 'true') {
        console.debug(`[GODOT-SERVER] Handling tool request: ${request.params.name}`);
      }

      switch (request.params.name) {
        case 'launch_editor':
          return await this.toolHandlers.handleLaunchEditor(request.params.arguments);
        case 'run_project':
          return await this.toolHandlers.handleRunProject(request.params.arguments);
        case 'get_debug_output':
          return await this.toolHandlers.handleGetDebugOutput();
        case 'stop_project':
          return await this.toolHandlers.handleStopProject();
        case 'get_godot_version':
          return await this.toolHandlers.handleGetGodotVersion();
        case 'list_projects':
          return await this.toolHandlers.handleListProjects(request.params.arguments);
        case 'get_project_info':
          return await this.toolHandlers.handleGetProjectInfo(request.params.arguments);
        case 'create_scene':
          return await this.toolHandlers.handleCreateScene(request.params.arguments);
        case 'add_node':
          return await this.toolHandlers.handleAddNode(request.params.arguments);
        case 'load_sprite':
          return await this.toolHandlers.handleLoadSprite(request.params.arguments);
        case 'export_mesh_library':
          return await this.toolHandlers.handleExportMeshLibrary(request.params.arguments);
        case 'save_scene':
          return await this.toolHandlers.handleSaveScene(request.params.arguments);
        case 'get_uid':
          return await this.toolHandlers.handleGetUid(request.params.arguments);
        case 'update_project_uids':
          return await this.toolHandlers.handleUpdateProjectUids(request.params.arguments);
        case 'create_tilemap':
          return await this.toolHandlers.handleCreateTilemap(request.params.arguments);
        case 'create_tileset':
          return await this.toolHandlers.handleCreateTileset(request.params.arguments);
        case 'set_tilemap_source':
          return await this.toolHandlers.handleSetTilemapSource(request.params.arguments);
        case 'paint_tiles':
          return await this.toolHandlers.handlePaintTiles(request.params.arguments);
        case 'add_tileset_source':
          return await this.toolHandlers.handleAddTilesetSource(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  /**
   * Run the MCP server
   */
  async run() {
    try {
      // Detect Godot path before starting the server
      await this.pathManager.detectGodotPath();

      const godotPath = this.pathManager.getPath();
      if (!godotPath) {
        console.error('[GODOT-SERVER] Failed to find a valid Godot executable path');
        console.error('[GODOT-SERVER] Please set GODOT_PATH environment variable or provide a valid path');
        process.exit(1);
      }

      // Check if the path is valid
      const isValid = await this.pathManager.isValidGodotPath(godotPath);

      if (!isValid) {
        console.warn(`[GODOT-SERVER] Warning: Using potentially invalid Godot path: ${godotPath}`);
        console.warn('[GODOT-SERVER] This may cause issues when executing Godot commands');
      }

      console.log(`[GODOT-SERVER] Using Godot at: ${godotPath}`);

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      console.error('Godot MCP server running on stdio');
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[GODOT-SERVER] Failed to start:', errorMessage);
      process.exit(1);
    }
  }
}